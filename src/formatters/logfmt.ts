import { contextFields, type Formatter, type LogEntry } from "../core.js";

/** `key=value` lines (Heroku/Grafana Loki style). */
export function logfmtFormatter(): Formatter {
  return (entry: LogEntry): string => {
    const pairs: Array<[string, unknown]> = [
      ["time", entry.time.toISOString()],
      ["level", entry.level],
      ["msg", entry.message],
    ];
    if (entry.name !== undefined) {
      pairs.push(["logger", entry.name]);
    }
    pairs.push(...Object.entries(contextFields(entry)));
    if (entry.error !== undefined) {
      pairs.push(["error", entry.error.message], ["error_type", entry.error.name]);
    }
    return pairs.map(([key, value]) => `${key}=${encode(value)}`).join(" ");
  };
}

function encode(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  const text = typeof value === "string" ? value : stringify(value);
  return /[\s="\\]/.test(text) || text === "" ? JSON.stringify(text) : text;
}

function stringify(value: unknown): string {
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "[unserializable]";
    }
  }
  return String(value);
}
