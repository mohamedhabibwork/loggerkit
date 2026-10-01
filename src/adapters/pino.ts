import type { LogLevel } from "../core.js";
import type { Logger } from "../logger.js";

export interface PinoDestination {
  write(line: string): void;
}

const PINO_LEVELS: ReadonlyArray<[number, LogLevel]> = [
  [60, "fatal"],
  [50, "error"],
  [40, "warn"],
  [30, "info"],
  [20, "debug"],
  [10, "trace"],
];

const PINO_META = new Set(["level", "time", "msg", "pid", "hostname", "err", "v", "name"]);

/**
 * Destination stream for a real pino instance: `pino(opts, createPinoDestination(logger))`.
 * Each NDJSON line pino writes is parsed and re-emitted through loggerkit,
 * so pino-based libraries (Fastify plugins, etc.) land in your sinks.
 */
export function createPinoDestination(logger: Logger): PinoDestination {
  return {
    write(line: string): void {
      let record: Record<string, unknown>;
      try {
        record = JSON.parse(line) as Record<string, unknown>;
      } catch {
        logger.info(line.trimEnd());
        return;
      }
      const level = toLevel(record.level);
      const message = typeof record.msg === "string" ? record.msg : "";
      const fields: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(record)) {
        if (!PINO_META.has(key)) {
          fields[key] = value;
        }
      }
      if (record.err !== null && typeof record.err === "object") {
        fields.error = toError(record.err as Record<string, unknown>);
      }
      logger[level](message, fields);
    },
  };
}

function toLevel(value: unknown): LogLevel {
  if (typeof value === "number") {
    return PINO_LEVELS.find(([threshold]) => value >= threshold)?.[1] ?? "trace";
  }
  if (typeof value === "string") {
    const match = PINO_LEVELS.find(([, name]) => name === value);
    if (match !== undefined) {
      return match[1];
    }
  }
  return "info";
}

function toError(raw: Record<string, unknown>): Error {
  const error = new Error(typeof raw.message === "string" ? raw.message : "Unknown error");
  if (typeof raw.type === "string") {
    error.name = raw.type;
  }
  if (typeof raw.stack === "string") {
    error.stack = raw.stack;
  }
  return error;
}
