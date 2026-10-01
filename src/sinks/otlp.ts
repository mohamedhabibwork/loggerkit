import { safeStringify, contextFields, type LogEntry, type LogLevel } from "../core.js";
import { BatchingSink, type BatchOptions } from "./batch.js";
import { sendHttp } from "./transport.js";

export interface OtlpSinkOptions extends BatchOptions {
  /**
   * OTLP/HTTP endpoint base, e.g. `http://otel-collector:4318`; `/v1/logs`
   * is appended unless the URL already ends with it. Works with the
   * OpenTelemetry Collector, Grafana Alloy, Honeycomb, New Relic, SigNoz,
   * Uptrace, Axiom and other OTLP backends.
   */
  endpoint: string;
  headers?: Record<string, string>;
  /** Resource attributes, e.g. `{ "service.name": "api" }`. */
  resource?: Record<string, string | number | boolean>;
  serviceName?: string;
  timeoutMs?: number;
  name?: string;
}

const SEVERITY: Readonly<Record<LogLevel, number>> = {
  trace: 1,
  debug: 5,
  info: 9,
  warn: 13,
  error: 17,
  fatal: 21,
};

type AnyValue =
  | { stringValue: string }
  | { boolValue: boolean }
  | { intValue: string }
  | { doubleValue: number }
  | { arrayValue: { values: AnyValue[] } }
  | { kvlistValue: { values: KeyValue[] } };

interface KeyValue {
  key: string;
  value: AnyValue;
}

/** Native OpenTelemetry logs sink (OTLP/HTTP JSON). */
export class OtlpSink extends BatchingSink {
  private readonly url: string;
  private readonly headers: Record<string, string>;
  private readonly resource: KeyValue[];
  private readonly timeoutMs?: number;

  constructor(options: OtlpSinkOptions) {
    super(options.name ?? "otlp", options);
    const base = options.endpoint.replace(/\/+$/, "");
    this.url = base.endsWith("/v1/logs") ? base : `${base}/v1/logs`;
    this.headers = { "content-type": "application/json", ...options.headers };
    this.resource = toAttributes({
      ...(options.serviceName === undefined ? {} : { "service.name": options.serviceName }),
      ...options.resource,
    });
    this.timeoutMs = options.timeoutMs;
  }

  protected async send(entries: readonly LogEntry[]): Promise<void> {
    const body = {
      resourceLogs: [
        {
          resource: { attributes: this.resource },
          scopeLogs: [
            {
              scope: { name: "loggerkit" },
              logRecords: entries.map((entry) => toLogRecord(entry)),
            },
          ],
        },
      ],
    };
    await sendHttp({
      url: this.url,
      body: safeStringify(body),
      headers: this.headers,
      timeoutMs: this.timeoutMs,
    });
  }
}

function toLogRecord(entry: LogEntry): Record<string, unknown> {
  const { traceId, spanId, ...fields } = contextFields(entry);
  const attributes: Record<string, unknown> = { ...fields };
  if (entry.name !== undefined) {
    attributes["logger.name"] = entry.name;
  }
  if (entry.error !== undefined) {
    attributes["exception.type"] = entry.error.name;
    attributes["exception.message"] = entry.error.message;
    if (entry.error.stack !== undefined) {
      attributes["exception.stacktrace"] = entry.error.stack;
    }
  }
  const nanos = `${BigInt(entry.time.getTime()) * 1_000_000n}`;
  return {
    timeUnixNano: nanos,
    observedTimeUnixNano: nanos,
    severityNumber: SEVERITY[entry.level],
    severityText: entry.level.toUpperCase(),
    body: { stringValue: entry.message },
    attributes: toAttributes(attributes),
    ...(isHexId(traceId, 32) ? { traceId } : {}),
    ...(isHexId(spanId, 16) ? { spanId } : {}),
  };
}

function isHexId(value: unknown, length: number): value is string {
  return typeof value === "string" && value.length === length && /^[0-9a-f]+$/.test(value);
}

function toAttributes(values: Record<string, unknown>): KeyValue[] {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => ({ key, value: toAnyValue(value, 0) }));
}

const MAX_ATTRIBUTE_DEPTH = 8;

function toAnyValue(value: unknown, depth: number): AnyValue {
  if (typeof value === "string") {
    return { stringValue: value };
  }
  if (typeof value === "boolean") {
    return { boolValue: value };
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return { stringValue: String(value) };
    }
    return Number.isSafeInteger(value) ? { intValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === "bigint") {
    return { intValue: value.toString() };
  }
  if (depth < MAX_ATTRIBUTE_DEPTH && Array.isArray(value)) {
    return { arrayValue: { values: value.map((item) => toAnyValue(item, depth + 1)) } };
  }
  if (depth < MAX_ATTRIBUTE_DEPTH && value !== null && typeof value === "object") {
    if (value instanceof Date) {
      return { stringValue: value.toISOString() };
    }
    return {
      kvlistValue: {
        values: Object.entries(value).map(([key, item]) => ({
          key,
          value: toAnyValue(item, depth + 1),
        })),
      },
    };
  }
  return { stringValue: String(value) };
}
