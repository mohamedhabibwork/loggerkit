import {
  internalError,
  levelEnabled,
  parseLevel,
  type ContextProvider,
  type Formatter,
  type LogEntry,
  type LogLevel,
  type Processor,
  type Sink,
} from "./core.js";

export interface LoggerOptions {
  name?: string;
  level?: LogLevel | string;
  sinks?: Sink[];
  formatter?: Formatter;
  bindings?: Record<string, unknown>;
  /** Run in order on every entry; a processor returning null drops the entry. */
  processors?: Processor[];
  /** Ambient fields merged under call-site fields (see `createLogContext`). */
  contextProvider?: ContextProvider;
  /** Error thrown when a sink rejects; defaults to warn-and-continue via console.error. */
  onError?: (error: unknown, sinkName: string) => void;
}

/**
 * Emits structured entries to every registered sink, after level
 * filtering and context merging. Loggers are cheap to create; `child`
 * shares sink references but keeps bindings isolated.
 */
export class Logger {
  readonly name?: string;
  readonly formatter?: Formatter;
  private currentLevel: LogLevel;
  private readonly sinks: Sink[];
  private readonly bindings: Record<string, unknown>;
  private readonly onError: (error: unknown, sinkName: string) => void;
  private readonly processors: readonly Processor[];
  private readonly contextProvider?: ContextProvider;
  private seq = 0;

  constructor(options: LoggerOptions = {}) {
    this.name = options.name;
    this.currentLevel = options.level === undefined ? "info" : parseLevel(options.level);
    this.sinks = options.sinks === undefined ? [] : [...options.sinks];
    this.formatter = options.formatter;
    this.bindings = { ...options.bindings };
    this.onError = options.onError ?? defaultOnError;
    this.processors = [...(options.processors ?? [])];
    this.contextProvider = options.contextProvider;
  }

  /** True when an entry at `level` would be emitted; use to skip costly field building. */
  isLevelEnabled(level: LogLevel): boolean {
    return levelEnabled(level, this.currentLevel);
  }

  /**
   * Starts a timer; the returned function logs `message` with
   * `durationMs` at `level` (default `debug`) and returns the duration.
   */
  time(message: string, level: LogLevel = "debug"): (fields?: Record<string, unknown>) => number {
    const startedAt = performance.now();
    return (fields) => {
      const durationMs = Math.round((performance.now() - startedAt) * 1000) / 1000;
      this.emit(level, message, { ...fields, durationMs });
      return durationMs;
    };
  }

  get level(): LogLevel {
    return this.currentLevel;
  }

  setLevel(level: LogLevel | string): void {
    this.currentLevel = parseLevel(level);
  }

  addSink(sink: Sink): void {
    this.sinks.push(sink);
  }

  removeSink(sinkName: string): boolean {
    const index = this.sinks.findIndex((sink) => sink.name === sinkName);
    if (index === -1) {
      return false;
    }
    this.sinks.splice(index, 1);
    return true;
  }

  listSinks(): string[] {
    return this.sinks.map((sink) => sink.name);
  }

  /** Creates a sub-logger with additional bindings; shares sinks and level. */
  child(name: string, bindings: Record<string, unknown> = {}): Logger {
    let childName: string | undefined;
    if (name === "") {
      childName = this.name;
    } else if (this.name === undefined) {
      childName = name;
    } else {
      childName = `${this.name}:${name}`;
    }
    return new Logger({
      name: childName,
      level: this.currentLevel,
      sinks: this.sinks,
      formatter: this.formatter,
      bindings: { ...this.bindings, ...bindings },
      onError: this.onError,
      processors: [...this.processors],
      contextProvider: this.contextProvider,
    });
  }

  trace(message: string, fields?: Record<string, unknown>): void {
    this.emit("trace", message, fields);
  }

  debug(message: string, fields?: Record<string, unknown>): void {
    this.emit("debug", message, fields);
  }

  info(message: string, fields?: Record<string, unknown>): void {
    this.emit("info", message, fields);
  }

  warn(message: string, fields?: Record<string, unknown>): void {
    this.emit("warn", message, fields);
  }

  error(message: string, errorOrFields?: Error | Record<string, unknown>): void {
    if (errorOrFields instanceof Error) {
      this.emit("error", message, { error: errorOrFields });
    } else {
      this.emit("error", message, errorOrFields);
    }
  }

  fatal(message: string, errorOrFields?: Error | Record<string, unknown>): void {
    if (errorOrFields instanceof Error) {
      this.emit("fatal", message, { error: errorOrFields });
    } else {
      this.emit("fatal", message, errorOrFields);
    }
  }

  private emit(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
    if (!levelEnabled(level, this.currentLevel)) {
      return;
    }
    this.seq += 1;
    let ambient: Readonly<Record<string, unknown>> | undefined;
    try {
      ambient = this.contextProvider?.();
    } catch (error) {
      this.onError(error, "contextProvider");
    }
    const merged = ambient === undefined ? fields : { ...ambient, ...fields };
    const entry = this.process(
      buildEntry(this.seq, this.name, level, message, this.bindings, merged),
    );
    if (entry === undefined) {
      return;
    }
    for (const sink of this.sinks) {
      try {
        const result = sink.write(entry);
        if (result instanceof Promise) {
          result.catch((error: unknown) => this.onError(error, sink.name));
        }
      } catch (error) {
        this.onError(error, sink.name);
      }
    }
  }

  private process(entry: LogEntry): LogEntry | undefined {
    let current: LogEntry | null | undefined = entry;
    for (const processor of this.processors) {
      try {
        current = processor(current);
      } catch (error) {
        this.onError(error, "processor");
        return undefined;
      }
      if (current === null || current === undefined) {
        return undefined;
      }
    }
    return current;
  }

  /** Waits for all async sink writes currently in flight. */
  async flush(): Promise<void> {
    await Promise.all(
      this.sinks.map(async (sink) => {
        if (sink.flush !== undefined) {
          await sink.flush();
        }
      }),
    );
  }

  /** Closes every sink and clears the sink list. */
  async close(): Promise<void> {
    const sinks = [...this.sinks];
    this.sinks.length = 0;
    for (const sink of sinks) {
      try {
        if (sink.close !== undefined) {
          await sink.close();
        }
      } catch (error) {
        this.onError(error, sink.name);
      }
    }
  }
}

function buildEntry(
  seq: number,
  name: string | undefined,
  level: LogLevel,
  message: string,
  bindings: Record<string, unknown>,
  fields: Record<string, unknown> | undefined,
): LogEntry {
  let error: Error | undefined;
  const context: Record<string, unknown> = { ...bindings, ...fields };
  if (context.error instanceof Error) {
    error = context.error;
  }
  return {
    seq,
    time: new Date(),
    level,
    message,
    context,
    ...(name === undefined ? {} : { name }),
    ...(error === undefined ? {} : { error }),
  };
}

function defaultOnError(error: unknown, sinkName: string): void {
  internalError(`[loggerkit] sink "${sinkName}" failed to write:`, error);
}
