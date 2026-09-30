import type { LogEntry, LogLevel } from "./core.js";
import { MemorySink } from "./sinks/memory.js";

export { MemorySink } from "./sinks/memory.js";

export interface CaptureLogger {
  entries: LogEntry[];
  byLevel(level: LogLevel): LogEntry[];
  messages(): string[];
  clear(): void;
  sink: MemorySink;
}

/**
 * Testing helper: a MemorySink plus assertion-friendly views. Pass
 * `capture.sink` into any Logger.
 */
export function createCapture(): CaptureLogger {
  const sink = new MemorySink({ name: "capture" });
  return {
    sink,
    get entries(): LogEntry[] {
      return sink.entries();
    },
    byLevel(level: LogLevel): LogEntry[] {
      return sink.byLevel(level);
    },
    messages(): string[] {
      return sink.entries().map((entry) => entry.message);
    },
    clear(): void {
      sink.clear();
    },
  };
}
