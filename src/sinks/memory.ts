import { levelWeight, SinkClosedError, type LogEntry, type LogLevel, type Sink } from "../core.js";

export interface MemorySinkOptions {
  name?: string;
  /** Maximum entries retained; oldest entries are evicted. Defaults to unbounded. */
  maxEntries?: number;
}

/**
 * Keeps entries in a bounded in-memory buffer. Primary use is testing,
 * debugging, and tail-based inspection. Copy out via `entries()` — the
 * returned array is a snapshot.
 */
export class MemorySink implements Sink {
  readonly name: string;
  private readonly buffer: LogEntry[] = [];
  private readonly maxEntries?: number;
  private closed = false;

  constructor(options: MemorySinkOptions = {}) {
    this.name = options.name ?? "memory";
    this.maxEntries = options.maxEntries;
  }

  write(entry: LogEntry): void {
    if (this.closed) {
      throw new SinkClosedError(this.name);
    }
    this.buffer.push(entry);
    if (this.maxEntries !== undefined && this.buffer.length > this.maxEntries) {
      this.buffer.splice(0, this.buffer.length - this.maxEntries);
    }
  }

  entries(): LogEntry[] {
    return [...this.buffer];
  }

  /** Entries at or above `level`, filtered by weight. */
  byLevel(level: LogLevel): LogEntry[] {
    const min = levelWeight(level);
    return this.buffer.filter((entry) => levelWeight(entry.level) >= min);
  }

  clear(): void {
    this.buffer.length = 0;
  }

  close(): void {
    this.closed = true;
  }
}
