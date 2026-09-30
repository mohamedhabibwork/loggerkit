import { type Formatter, type LogLevel, type Sink, UnknownSinkError } from "./core.js";
import { Logger, type LoggerOptions } from "./logger.js";
import { createConsoleSink } from "./sinks/console.js";
import { FileSink } from "./sinks/file.js";
import { HttpSink } from "./sinks/http.js";
import { MemorySink } from "./sinks/memory.js";

export type SinkKind = "console" | "memory" | "file" | "http";

export interface SinkSpec {
  kind: SinkKind;
  name?: string;
  minLevel?: LogLevel;
  formatter?: Formatter;
  /** file sink */
  filePath?: string;
  maxBytes?: number;
  maxFiles?: number;
  /** http sink */
  url?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  batchSize?: number;
}

export interface CreateLoggerOptions extends Omit<LoggerOptions, "sinks"> {
  /** Declarative sink list resolved by the factory. */
  sinks?: (Sink | SinkSpec)[];
}

function isSink(value: Sink | SinkSpec): value is Sink {
  return typeof value === "object" && value !== null && typeof (value as Sink).write === "function";
}

export function resolveSink(spec: SinkSpec): Sink {
  const { kind } = spec;
  if (kind === "console") {
    return createConsoleSink({
      name: spec.name,
      formatter: spec.formatter,
      minLevel: spec.minLevel,
    });
  }
  if (kind === "memory") {
    return new MemorySink({ name: spec.name });
  }
  if (kind === "file") {
    if (spec.filePath === undefined) {
      throw new LoggerKitFactoryError('Sink kind "file" requires "filePath".');
    }
    return new FileSink({
      filePath: spec.filePath,
      name: spec.name,
      formatter: spec.formatter,
      maxBytes: spec.maxBytes,
      maxFiles: spec.maxFiles,
    });
  }
  if (kind === "http") {
    if (spec.url === undefined) {
      throw new LoggerKitFactoryError('Sink kind "http" requires "url".');
    }
    return new HttpSink({
      url: spec.url,
      name: spec.name,
      formatter: spec.formatter,
      headers: spec.headers,
      timeoutMs: spec.timeoutMs,
      batchSize: spec.batchSize,
    });
  }
  throw new UnknownSinkError(String(kind));
}

export class LoggerKitFactoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoggerKitFactoryError";
  }
}

/** Builds a Logger from declarative options; sink specs are resolved to concrete sinks. */
export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const sinks: Sink[] = (options.sinks ?? []).map((sinkOrSpec) =>
    isSink(sinkOrSpec) ? sinkOrSpec : resolveSink(sinkOrSpec),
  );
  return new Logger({ ...options, sinks });
}

/**
 * Creates a Logger with a MemorySink attached, returning both. Useful
 * for tests and local inspection.
 */
export function createMemoryLogger(options: CreateLoggerOptions = {}): {
  logger: Logger;
  memory: MemorySink;
} {
  const memory = new MemorySink();
  const logger = createLogger({ ...options, sinks: [memory, ...(options.sinks ?? [])] });
  return { logger, memory };
}
