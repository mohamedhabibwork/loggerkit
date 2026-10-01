import { contextFields, safeStringify, type Formatter, type LogEntry } from "../core.js";

export interface EcsFormatterOptions {
  /** `service.name` on every document. */
  serviceName?: string;
  /** `service.version`. */
  serviceVersion?: string;
  /** `service.environment`. */
  environment?: string;
}

const ECS_VERSION = "8.11.0";

/**
 * Builds an Elastic Common Schema document. Used by the Elasticsearch
 * and Logstash sinks; Kibana, Elastic APM and OpenSearch Dashboards
 * understand these field names natively. `traceId`/`spanId` context
 * fields map to `trace.id`/`span.id`.
 */
export function toEcsDocument(
  entry: LogEntry,
  options: EcsFormatterOptions = {},
): Record<string, unknown> {
  const { traceId, spanId, ...fields } = contextFields(entry);
  const document: Record<string, unknown> = {
    ...fields,
    "@timestamp": entry.time.toISOString(),
    "log.level": entry.level,
    message: entry.message,
    "ecs.version": ECS_VERSION,
  };
  if (entry.name !== undefined) {
    document["log.logger"] = entry.name;
  }
  if (options.serviceName !== undefined) {
    document["service.name"] = options.serviceName;
  }
  if (options.serviceVersion !== undefined) {
    document["service.version"] = options.serviceVersion;
  }
  if (options.environment !== undefined) {
    document["service.environment"] = options.environment;
  }
  if (typeof traceId === "string") {
    document["trace.id"] = traceId;
  }
  if (typeof spanId === "string") {
    document["span.id"] = spanId;
  }
  if (entry.error !== undefined) {
    document["error.type"] = entry.error.name;
    document["error.message"] = entry.error.message;
    if (entry.error.stack !== undefined) {
      document["error.stack_trace"] = entry.error.stack;
    }
  }
  return document;
}

/** One ECS JSON document per line. */
export function ecsFormatter(options: EcsFormatterOptions = {}): Formatter {
  return (entry) => safeStringify(toEcsDocument(entry, options));
}
