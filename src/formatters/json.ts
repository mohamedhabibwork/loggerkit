import type { Formatter, LogEntry } from "../core.js";

const RESERVED_KEYS = new Set(["seq", "time", "level", "message", "name", "error"]);

/** Renders entries as one JSON object per line (NDJSON). */
export function jsonFormatter(): Formatter {
  return (entry: LogEntry): string => {
    const payload: Record<string, unknown> = {
      seq: entry.seq,
      time: entry.time.toISOString(),
      level: entry.level,
      message: entry.message,
    };
    if (entry.name !== undefined) {
      payload.name = entry.name;
    }
    for (const [key, value] of Object.entries(entry.context)) {
      if (!RESERVED_KEYS.has(key)) {
        payload[key] = value;
      }
    }
    if (entry.error !== undefined) {
      payload.error = serializeError(entry.error);
    }
    return JSON.stringify(payload);
  };
}

function serializeError(error: Error): Record<string, unknown> {
  const output: Record<string, unknown> = {
    name: error.name,
    message: error.message,
  };
  if (error.stack !== undefined) {
    output.stack = error.stack;
  }
  const cause = (error as { cause?: unknown }).cause;
  if (cause !== undefined) {
    output.cause = cause instanceof Error ? serializeError(cause) : cause;
  }
  return output;
}
