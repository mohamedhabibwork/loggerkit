import { type Formatter, type LogEntry, type Sink, SinkClosedError } from "../core.js";
import { jsonFormatter } from "../formatters/json.js";

export interface HttpSinkOptions {
  /** Endpoint that accepts POST with a JSON body. */
  url: string;
  name?: string;
  formatter?: Formatter;
  /** Extra headers, e.g. auth tokens. `content-type` is set automatically. */
  headers?: Record<string, string>;
  /** Fetch timeout in milliseconds. Defaults to 5000. */
  timeoutMs?: number;
  /** Batch size before flushing; entries are sent as an array when batched. Defaults to 1. */
  batchSize?: number;
  /** Extra HTTP method; defaults to POST. */
  method?: "POST" | "PUT";
}

/**
 * Ships rendered entries to an HTTP endpoint using global `fetch`
 * (Node >= 20 has it built in). Failures never throw into the logger:
 * they are swallowed after logging a warning via console.warn, so a
 * down telemetry backend cannot take down the application.
 */
export class HttpSink implements Sink {
  readonly name: string;
  private readonly url: string;
  private readonly formatter: Formatter;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly batchSize: number;
  private readonly method: "POST" | "PUT";
  private queue: string[] = [];
  private closed = false;

  constructor(options: HttpSinkOptions) {
    this.name = options.name ?? "http";
    this.url = options.url;
    this.formatter = options.formatter ?? jsonFormatter();
    this.headers = { "content-type": "application/json", ...options.headers };
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.batchSize = Math.max(1, options.batchSize ?? 1);
    this.method = options.method ?? "POST";
  }

  write(entry: LogEntry): void {
    if (this.closed) {
      throw new SinkClosedError(this.name);
    }
    this.queue.push(this.formatter(entry));
    if (this.queue.length >= this.batchSize) {
      void this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.queue.length === 0) {
      return;
    }
    const batch = this.queue;
    this.queue = [];
    const body = batch.length === 1 ? (batch[0] ?? "") : `[${batch.join(",")}]`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        await fetch(this.url, {
          method: this.method,
          headers: this.headers,
          body,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      console.warn(`[loggerkit] http sink "${this.name}" failed to deliver log batch:`, error);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.flush();
  }
}
