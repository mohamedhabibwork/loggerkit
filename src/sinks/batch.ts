import { internalWarn, type LogEntry, type Sink, SinkClosedError } from "../core.js";

/**
 * Thrown by `send()` when part of a batch was already delivered: only
 * `remaining` is retried, so delivered entries are never duplicated.
 */
export class PartialBatchError extends Error {
  readonly remaining: readonly LogEntry[];
  constructor(remaining: readonly LogEntry[], cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "PartialBatchError";
    this.remaining = remaining;
    this.cause = cause;
  }
}

/** Errors may set `retryable: false` (e.g. HTTP 400/401) to skip retries. */
function isRetryable(error: unknown): boolean {
  const flag = (error as { retryable?: unknown } | null)?.retryable;
  return flag !== false;
}

export interface BatchOptions {
  /** Entries per request; a full batch flushes immediately. Defaults to 100. */
  batchSize?: number;
  /** Max time an entry waits before a flush. Defaults to 2000 ms. */
  flushIntervalMs?: number;
  /** Buffered entries kept while the backend is down; oldest are dropped first. Defaults to 10000. */
  maxQueueSize?: number;
  /** Retries per batch after the first attempt. Defaults to 3. */
  retries?: number;
  /** Base delay for exponential backoff. Defaults to 250 ms. */
  retryDelayMs?: number;
  /** Called when a batch is finally dropped; defaults to console.warn. */
  onError?: (error: unknown, droppedEntries: number) => void;
}

const DEFAULTS = {
  batchSize: 100,
  flushIntervalMs: 2000,
  maxQueueSize: 10_000,
  retries: 3,
  retryDelayMs: 250,
} as const;

/**
 * Base class for network sinks: buffers entries, ships them in batches
 * on size or interval, retries with exponential backoff, and bounds
 * memory with a drop-oldest queue. Delivery failures never throw into
 * the logger — a down backend cannot take down the application.
 */
export abstract class BatchingSink implements Sink {
  readonly name: string;
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;
  private readonly maxQueueSize: number;
  private readonly retries: number;
  private readonly retryDelayMs: number;
  private readonly onError: (error: unknown, droppedEntries: number) => void;
  private queue: LogEntry[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: Promise<void> = Promise.resolve();
  private closed = false;
  private closing?: Promise<void>;
  private droppedOverflow = 0;

  protected constructor(name: string, options: BatchOptions = {}) {
    this.name = name;
    this.batchSize = Math.max(1, options.batchSize ?? DEFAULTS.batchSize);
    this.flushIntervalMs = Math.max(0, options.flushIntervalMs ?? DEFAULTS.flushIntervalMs);
    this.maxQueueSize = Math.max(this.batchSize, options.maxQueueSize ?? DEFAULTS.maxQueueSize);
    this.retries = Math.max(0, options.retries ?? DEFAULTS.retries);
    this.retryDelayMs = Math.max(0, options.retryDelayMs ?? DEFAULTS.retryDelayMs);
    this.onError =
      options.onError ??
      ((error, dropped) =>
        internalWarn(`[loggerkit] sink "${name}" dropped ${dropped} entries:`, error));
  }

  /** Ships one batch; throw to trigger a retry. */
  protected abstract send(entries: readonly LogEntry[]): Promise<void>;

  /** Releases transport resources (sockets); called once on close. */
  protected async dispose(): Promise<void> {}

  /** Entries dropped because the queue overflowed since the last call. */
  takeDroppedCount(): number {
    const count = this.droppedOverflow;
    this.droppedOverflow = 0;
    return count;
  }

  write(entry: LogEntry): void {
    if (this.closed) {
      throw new SinkClosedError(this.name);
    }
    this.queue.push(entry);
    if (this.queue.length > this.maxQueueSize) {
      this.queue.shift();
      this.droppedOverflow += 1;
    }
    if (this.queue.length >= this.batchSize) {
      void this.flush();
    } else {
      this.schedule();
    }
  }

  flush(): Promise<void> {
    this.clearTimer();
    // Never let one failed drain poison every later flush.
    this.pending = this.pending.catch(() => undefined).then(() => this.drain());
    return this.pending.catch((error: unknown) => this.report(error, 0));
  }

  close(): Promise<void> {
    this.closing ??= (async () => {
      this.closed = true;
      try {
        await this.flush();
      } finally {
        await this.dispose();
      }
    })();
    return this.closing;
  }

  /** Reports entries a subclass rejected permanently (e.g. ES 4xx items). */
  protected report(error: unknown, droppedEntries: number): void {
    try {
      this.onError(error, droppedEntries);
    } catch (handlerError) {
      internalWarn(`[loggerkit] onError for sink "${this.name}" threw:`, handlerError);
    }
  }

  private async drain(): Promise<void> {
    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, this.batchSize);
      await this.deliver(batch);
    }
  }

  private async deliver(batch: readonly LogEntry[]): Promise<void> {
    let pending = batch;
    for (let attempt = 0; ; attempt += 1) {
      try {
        await this.send(pending);
        return;
      } catch (error) {
        let cause = error;
        if (error instanceof PartialBatchError) {
          pending = error.remaining;
          cause = error.cause;
          if (pending.length === 0) {
            return;
          }
        }
        if (attempt >= this.retries || !isRetryable(cause)) {
          this.report(cause, pending.length);
          return;
        }
        await delay(this.retryDelayMs * 2 ** attempt);
      }
    }
  }

  private schedule(): void {
    if (this.timer !== undefined) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, this.flushIntervalMs);
    (this.timer as { unref?: () => void }).unref?.();
  }

  private clearTimer(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
