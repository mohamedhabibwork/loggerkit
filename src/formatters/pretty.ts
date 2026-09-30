import type { Formatter, LogEntry } from "../core.js";

const LEVEL_PAD_WIDTH = 5;

/** Renders human-readable single-line entries, e.g. `INFO  api request ok durationMs=12`. */
export function prettyFormatter(): Formatter {
  return (entry: LogEntry): string => {
    const time = entry.time.toISOString().slice(11, 23);
    const level = entry.level.toUpperCase().padEnd(LEVEL_PAD_WIDTH, " ");
    const name = entry.name === undefined ? "" : ` ${entry.name}:`;
    const errorText =
      entry.error === undefined ? "" : ` ${entry.error.stack ?? entry.error.message}`;
    const contextText = renderContext(entry.context);
    return `${time} ${level}${name} ${entry.message}${contextText}${errorText}`;
  };
}

function renderContext(context: Readonly<Record<string, unknown>>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(context)) {
    if (key === "error") {
      continue;
    }
    parts.push(`${key}=${stringifyValue(value)}`);
  }
  return parts.length === 0 ? "" : ` ${parts.join(" ")}`;
}

function stringifyValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
