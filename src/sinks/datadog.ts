import { safeStringify, contextFields, serializeError, type LogEntry } from "../core.js";
import { BatchingSink, type BatchOptions } from "./batch.js";
import { sendHttp } from "./transport.js";

export interface DatadogSinkOptions extends BatchOptions {
  apiKey: string;
  /** Datadog site, e.g. `datadoghq.com`, `datadoghq.eu`, `us5.datadoghq.com`. */
  site?: string;
  service?: string;
  /** `ddsource`; defaults to `nodejs`. */
  source?: string;
  hostname?: string;
  /** Tags like `["env:prod", "team:core"]`. */
  tags?: string[];
  timeoutMs?: number;
  name?: string;
}

const MAX_DATADOG_BATCH = 1000;

/** Native Datadog Logs sink (HTTP intake v2). */
export class DatadogSink extends BatchingSink {
  private readonly options: DatadogSinkOptions;
  private readonly url: string;

  constructor(options: DatadogSinkOptions) {
    super(options.name ?? "datadog", {
      ...options,
      batchSize: Math.min(options.batchSize ?? 100, MAX_DATADOG_BATCH),
    });
    this.options = options;
    this.url = `https://http-intake.logs.${options.site ?? "datadoghq.com"}/api/v2/logs`;
  }

  protected async send(entries: readonly LogEntry[]): Promise<void> {
    const payload = entries.map((entry) => ({
      ...contextFields(entry),
      message: entry.message,
      status: entry.level === "fatal" ? "critical" : entry.level,
      date: entry.time.toISOString(),
      ddsource: this.options.source ?? "nodejs",
      ...(this.options.service === undefined ? {} : { service: this.options.service }),
      ...(this.options.hostname === undefined ? {} : { hostname: this.options.hostname }),
      ...(this.options.tags === undefined ? {} : { ddtags: this.options.tags.join(",") }),
      ...(entry.name === undefined ? {} : { logger: { name: entry.name } }),
      ...(entry.error === undefined
        ? {}
        : {
            error: {
              kind: entry.error.name,
              message: entry.error.message,
              stack: serializeError(entry.error).stack,
            },
          }),
    }));
    await sendHttp({
      url: this.url,
      body: safeStringify(payload),
      headers: { "content-type": "application/json", "dd-api-key": this.options.apiKey },
      timeoutMs: this.options.timeoutMs,
    });
  }
}
