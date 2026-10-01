import { type Formatter, type LogLevel, type Sink, UnknownSinkError } from "./core.js";
import { Logger, type LoggerOptions } from "./logger.js";
import { createConsoleSink } from "./sinks/console.js";
import { FileSink } from "./sinks/file.js";
import { HttpSink } from "./sinks/http.js";
import { MemorySink } from "./sinks/memory.js";
import { DatadogSink, type DatadogSinkOptions } from "./sinks/datadog.js";
import { ElasticsearchSink, type ElasticsearchSinkOptions } from "./sinks/elasticsearch.js";
import { GelfSink, type GelfSinkOptions } from "./sinks/gelf.js";
import { LogstashSink, type LogstashSinkOptions } from "./sinks/logstash.js";
import { LokiSink, type LokiSinkOptions } from "./sinks/loki.js";
import { OtlpSink, type OtlpSinkOptions } from "./sinks/otlp.js";
import { SplunkSink, type SplunkSinkOptions } from "./sinks/splunk.js";
import { SyslogSink, type SyslogSinkOptions } from "./sinks/syslog.js";

export type BasicSinkKind = "console" | "memory" | "file" | "http";

/** Native backend sinks, configured through `options`. */
export type NativeSinkSpec =
  | { kind: "elasticsearch"; options: ElasticsearchSinkOptions }
  | { kind: "logstash"; options: LogstashSinkOptions }
  | { kind: "loki"; options: LokiSinkOptions }
  | { kind: "datadog"; options: DatadogSinkOptions }
  | { kind: "otlp"; options: OtlpSinkOptions }
  | { kind: "syslog"; options: SyslogSinkOptions }
  | { kind: "gelf"; options: GelfSinkOptions }
  | { kind: "splunk"; options: SplunkSinkOptions };

export type SinkKind = BasicSinkKind | NativeSinkSpec["kind"];

export type SinkSpec = BasicSinkSpec | NativeSinkSpec;

export interface BasicSinkSpec {
  kind: BasicSinkKind;
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
  if ("options" in spec) {
    return resolveNativeSink(spec);
  }
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

function resolveNativeSink(spec: NativeSinkSpec): Sink {
  switch (spec.kind) {
    case "elasticsearch":
      return new ElasticsearchSink(spec.options);
    case "logstash":
      return new LogstashSink(spec.options);
    case "loki":
      return new LokiSink(spec.options);
    case "datadog":
      return new DatadogSink(spec.options);
    case "otlp":
      return new OtlpSink(spec.options);
    case "syslog":
      return new SyslogSink(spec.options);
    case "gelf":
      return new GelfSink(spec.options);
    case "splunk":
      return new SplunkSink(spec.options);
    default:
      throw new UnknownSinkError(String((spec as { kind: unknown }).kind));
  }
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
