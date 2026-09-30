import { parseLevel, type Formatter, type LogEntry, type LogLevel, type Sink } from "./core.js";
import { Logger } from "./logger.js";
import { createConsoleSink } from "./sinks/console.js";

export interface PinoCompatOptions {
  name?: string;
  level?: string;
  base?: Record<string, unknown>;
  /** Explicit sink list. When omitted, the facade writes NDJSON to the console (pino's default stream). */
  sinks?: Sink[];
  /** `false` omits `time`; a function supplies the value; `true`/omitted uses the entry time in epoch milliseconds. */
  timestamp?: boolean | (() => string);
}

type PinoChild = {
  level: string;
  child: (bindings: Record<string, unknown>) => PinoChild;
} & Record<LogLevel, (obj: Record<string, unknown> | string, msg?: string) => void>;

/**
 * Pino-style facade over the loggerkit core: same ergonomics
 * (`child()`, level methods, NDJSON output) so drop-in examples built
 * for pino keep working. Not a byte-for-byte pino clone — `msg`, `level`
 * (number), `time` and bindings are emitted with pino's field names.
 * Without an explicit `sinks` option it writes NDJSON to the console.
 */
export function pino(options: PinoCompatOptions = {}): PinoChild {
  const formatter: Formatter = (entry: LogEntry) => {
    const payload: Record<string, unknown> = {
      level: levelNumber(entry.level),
    };
    if (options.timestamp !== false) {
      payload.time =
        typeof options.timestamp === "function" ? options.timestamp() : entry.time.getTime();
    }
    payload.msg = entry.message;
    if (entry.name !== undefined) {
      payload.name = entry.name;
    }
    for (const [key, value] of Object.entries(entry.context)) {
      if (!RESERVED.has(key)) {
        payload[key] = value;
      }
    }
    if (entry.error !== undefined) {
      payload.err = {
        type: entry.error.name,
        message: entry.error.message,
        stack: entry.error.stack,
      };
    }
    return JSON.stringify(payload);
  };
  const sinks = options.sinks ?? [createConsoleSink({ formatter })];
  const logger = new Logger({
    name: options.name,
    level: parseLevel(options.level ?? "info"),
    sinks,
    formatter,
    bindings: { ...options.base },
  });
  return wrap(logger);
}

const RESERVED = new Set(["name", "level", "time", "msg", "err"]);

function levelNumber(level: LogLevel): number {
  return { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 }[level];
}

function wrap(logger: Logger): PinoChild {
  const methods = {
    trace: (obj: Record<string, unknown> | string, msg?: string) => emit(logger, "trace", obj, msg),
    debug: (obj: Record<string, unknown> | string, msg?: string) => emit(logger, "debug", obj, msg),
    info: (obj: Record<string, unknown> | string, msg?: string) => emit(logger, "info", obj, msg),
    warn: (obj: Record<string, unknown> | string, msg?: string) => emit(logger, "warn", obj, msg),
    error: (obj: Record<string, unknown> | string, msg?: string) => emit(logger, "error", obj, msg),
    fatal: (obj: Record<string, unknown> | string, msg?: string) => emit(logger, "fatal", obj, msg),
  } as Record<LogLevel, (obj: Record<string, unknown> | string, msg?: string) => void>;
  return {
    get level(): string {
      return logger.level;
    },
    set level(value: string) {
      logger.setLevel(parseLevel(value));
    },
    child: (bindings: Record<string, unknown>) => wrap(logger.child("", bindings)),
    ...methods,
  };
}

function emit(
  logger: Logger,
  level: LogLevel,
  obj: Record<string, unknown> | string,
  msg: string | undefined,
): void {
  if (typeof obj === "string") {
    logger[level](obj);
    return;
  }
  const message = msg ?? (typeof obj.msg === "string" ? obj.msg : "");
  const fields = { ...obj };
  delete (fields as Record<string, unknown>).msg;
  logger[level](message, fields);
}

export default pino;
