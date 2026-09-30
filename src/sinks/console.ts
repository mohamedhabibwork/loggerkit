import { levelEnabled, type Formatter, type LogEntry, type LogLevel, type Sink } from "../core.js";

export interface ConsoleSinkOptions {
  name?: string;
  /** Formatter used to render entries before emitting. Defaults to JSON. */
  formatter?: Formatter;
  /** Minimum level handled by this sink; lower levels are dropped. */
  minLevel?: LogLevel;
}

const LEVEL_METHOD: Record<LogLevel, "debug" | "info" | "warn" | "error"> = {
  trace: "debug",
  debug: "debug",
  info: "info",
  warn: "warn",
  error: "error",
  fatal: "error",
};

/**
 * Emits rendered entries through the global console. Never throws.
 * Intended for interactive use; use file/http sinks for production.
 */
export function createConsoleSink(options: ConsoleSinkOptions = {}): Sink {
  const name = options.name ?? "console";
  return {
    name,
    write(entry: LogEntry): void {
      if (options.minLevel !== undefined && !levelEnabled(entry.level, options.minLevel)) {
        return;
      }
      const line =
        options.formatter === undefined
          ? JSON.stringify(rawPayload(entry))
          : options.formatter(entry);
      const method = LEVEL_METHOD[entry.level];
      if (method === "debug") {
        // oxlint-disable-next-line eslint/no-console -- the console sink exists to emit console output
        console.debug(line);
      } else if (method === "info") {
        // oxlint-disable-next-line eslint/no-console -- the console sink exists to emit console output
        console.info(line);
      } else if (method === "warn") {
        console.warn(line);
      } else {
        console.error(line);
      }
    },
  };
}

function rawPayload(entry: LogEntry): Record<string, unknown> {
  return {
    time: entry.time.toISOString(),
    level: entry.level,
    message: entry.message,
    name: entry.name,
    ...entry.context,
  };
}
