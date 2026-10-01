import { safeStringify, type LogEntry } from "../core.js";
import { toEcsDocument, type EcsFormatterOptions } from "../formatters/ecs.js";
import { BatchingSink, PartialBatchError, type BatchOptions } from "./batch.js";
import { basicAuth, isRetryableStatus, sendHttp, TransportError } from "./transport.js";

export interface ElasticsearchSinkOptions extends BatchOptions, EcsFormatterOptions {
  /** Cluster URL, e.g. `https://es.example.com:9200`. Works with OpenSearch too. */
  node: string;
  /**
   * Target index or data stream. A function receives the entry; the
   * string form supports `{yyyy}`, `{MM}`, `{dd}` date tokens (UTC):
   * `"logs-app-{yyyy}.{MM}.{dd}"`. Defaults to `"logs-loggerkit-default"`.
   */
  index?: string | ((entry: LogEntry) => string);
  /** Use `create` ops, required by data streams. Defaults to true. */
  dataStream?: boolean;
  /** Elastic API key (base64 `id:key`). */
  apiKey?: string;
  username?: string;
  password?: string;
  /** Ingest pipeline name. */
  pipeline?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  name?: string;
  /** Document builder; defaults to ECS. */
  toDocument?: (entry: LogEntry) => Record<string, unknown>;
}

/**
 * Native Elasticsearch / OpenSearch sink using the `_bulk` API with ECS
 * documents. No client library needed.
 */
export class ElasticsearchSink extends BatchingSink {
  private readonly url: string;
  private readonly headers: Record<string, string>;
  private readonly resolveIndex: (entry: LogEntry) => string;
  private readonly operation: "create" | "index";
  private readonly toDocument: (entry: LogEntry) => Record<string, unknown>;
  private readonly timeoutMs?: number;

  constructor(options: ElasticsearchSinkOptions) {
    super(options.name ?? "elasticsearch", options);
    const base = options.node.replace(/\/+$/, "");
    const query = options.pipeline ? `?pipeline=${encodeURIComponent(options.pipeline)}` : "";
    this.url = `${base}/_bulk${query}`;
    this.headers = {
      "content-type": "application/x-ndjson",
      ...authHeaders(options),
      ...options.headers,
    };
    this.resolveIndex = indexResolver(options.index ?? "logs-loggerkit-default");
    this.operation = options.dataStream === false ? "index" : "create";
    this.toDocument = options.toDocument ?? ((entry) => toEcsDocument(entry, options));
    this.timeoutMs = options.timeoutMs;
  }

  protected async send(entries: readonly LogEntry[]): Promise<void> {
    const lines: string[] = [];
    for (const entry of entries) {
      lines.push(JSON.stringify({ [this.operation]: { _index: this.resolveIndex(entry) } }));
      lines.push(safeStringify(this.toDocument(entry)));
    }
    const text = await sendHttp({
      url: this.url,
      body: `${lines.join("\n")}\n`,
      headers: this.headers,
      timeoutMs: this.timeoutMs,
    });
    const result = parseBulkResponse(text);
    if (result.errors !== true) {
      return;
    }
    // Retry only transient item failures; 4xx items are dropped and
    // reported so already-indexed documents are never duplicated.
    const retry: LogEntry[] = [];
    let rejected = 0;
    let reason = "unknown";
    (result.items ?? []).forEach((item, index) => {
      const op = Object.values(item)[0];
      const entry = entries[index];
      if (op?.error === undefined || entry === undefined) {
        return;
      }
      if (isRetryableStatus(op.status ?? 500)) {
        retry.push(entry);
      } else {
        rejected += 1;
        reason = op.error.reason ?? op.error.type ?? reason;
      }
    });
    if (rejected > 0) {
      this.report(
        new TransportError(`Elasticsearch rejected ${rejected} documents: ${reason}`, 400),
        rejected,
      );
    }
    if (retry.length > 0) {
      throw new PartialBatchError(
        retry,
        new TransportError(`Elasticsearch asked to retry ${retry.length} documents`, 429),
      );
    }
  }
}

interface BulkResponse {
  errors?: boolean;
  items?: Array<Record<string, { status?: number; error?: { type?: string; reason?: string } }>>;
}

function parseBulkResponse(text: string): BulkResponse {
  try {
    return JSON.parse(text) as BulkResponse;
  } catch {
    return {};
  }
}

function authHeaders(options: ElasticsearchSinkOptions): Record<string, string> {
  if (options.apiKey !== undefined) {
    return { authorization: `ApiKey ${options.apiKey}` };
  }
  if (options.username !== undefined) {
    return { authorization: basicAuth(options.username, options.password ?? "") };
  }
  return {};
}

function indexResolver(index: string | ((entry: LogEntry) => string)): (entry: LogEntry) => string {
  if (typeof index === "function") {
    return index;
  }
  if (!index.includes("{")) {
    return () => index;
  }
  return (entry) => {
    const iso = entry.time.toISOString();
    return index
      .replaceAll("{yyyy}", iso.slice(0, 4))
      .replaceAll("{MM}", iso.slice(5, 7))
      .replaceAll("{dd}", iso.slice(8, 10));
  };
}
