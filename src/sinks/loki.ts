import { safeStringify, contextFields, serializeError, type LogEntry } from "../core.js";
import { BatchingSink, type BatchOptions } from "./batch.js";
import { basicAuth, sendHttp } from "./transport.js";

export interface LokiSinkOptions extends BatchOptions {
  /** Loki base URL, e.g. `http://loki:3100`. */
  url: string;
  /** Static stream labels; keep cardinality low. `level` is added automatically. */
  labels?: Record<string, string>;
  /** Context keys promoted to labels (low-cardinality values only). */
  labelKeys?: string[];
  /** Multi-tenant org id (`X-Scope-OrgID`). */
  tenantId?: string;
  username?: string;
  password?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  name?: string;
}

/** Native Grafana Loki sink using the JSON push API. */
export class LokiSink extends BatchingSink {
  private readonly options: LokiSinkOptions;
  private readonly url: string;
  private readonly headers: Record<string, string>;

  constructor(options: LokiSinkOptions) {
    super(options.name ?? "loki", options);
    this.options = options;
    this.url = `${options.url.replace(/\/+$/, "")}/loki/api/v1/push`;
    this.headers = {
      "content-type": "application/json",
      ...(options.tenantId === undefined ? {} : { "x-scope-orgid": options.tenantId }),
      ...(options.username === undefined
        ? {}
        : { authorization: basicAuth(options.username, options.password ?? "") }),
      ...options.headers,
    };
  }

  protected async send(entries: readonly LogEntry[]): Promise<void> {
    const streams = new Map<string, { stream: Record<string, string>; values: string[][] }>();
    for (const entry of entries) {
      const labels = this.labelsFor(entry);
      const key = safeStringify(labels);
      const stream = streams.get(key) ?? { stream: labels, values: [] };
      stream.values.push([toNanos(entry.time), this.line(entry)]);
      streams.set(key, stream);
    }
    await sendHttp({
      url: this.url,
      body: safeStringify({ streams: [...streams.values()] }),
      headers: this.headers,
      timeoutMs: this.options.timeoutMs,
    });
  }

  private labelsFor(entry: LogEntry): Record<string, string> {
    const labels: Record<string, string> = {};
    for (const [key, value] of Object.entries(this.options.labels ?? {})) {
      labels[labelName(key)] = value;
    }
    labels.level = entry.level;
    if (entry.name !== undefined) {
      labels.logger = entry.name;
    }
    for (const key of this.options.labelKeys ?? []) {
      const value = entry.context[key];
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        labels[labelName(key)] = String(value);
      }
    }
    return labels;
  }

  private line(entry: LogEntry): string {
    const promoted = new Set(this.options.labelKeys);
    const fields = Object.fromEntries(
      Object.entries(contextFields(entry)).filter(([key]) => !promoted.has(key)),
    );
    return safeStringify({
      message: entry.message,
      ...fields,
      ...(entry.error === undefined ? {} : { error: serializeError(entry.error) }),
    });
  }
}

/** Loki label names must match `[a-zA-Z_][a-zA-Z0-9_]*`. */
function labelName(key: string): string {
  const cleaned = key.replace(/[^a-zA-Z0-9_]/g, "_");
  return /^[a-zA-Z_]/.test(cleaned) ? cleaned : `_${cleaned}`;
}

function toNanos(time: Date): string {
  return `${BigInt(time.getTime()) * 1_000_000n}`;
}
