import { contextFields, serializeError, type Formatter, type LogEntry } from "../core.js";

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
    Object.assign(payload, contextFields(entry));
    if (entry.error !== undefined) {
      payload.error = serializeError(entry.error);
    }
    return JSON.stringify(payload);
  };
}
