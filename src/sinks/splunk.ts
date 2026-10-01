import { safeStringify, contextFields, serializeError, type LogEntry } from "../core.js";
import { BatchingSink, type BatchOptions } from "./batch.js";
import { sendHttp } from "./transport.js";

export interface SplunkSinkOptions extends BatchOptions {
  /** HEC base URL, e.g. `https://splunk.example.com:8088`. */
  url: string;
  /** HEC token. */
  token: string;
  index?: string;
  source?: string;
  sourcetype?: string;
  host?: string;
  timeoutMs?: number;
  name?: string;
}

/** Native Splunk HTTP Event Collector sink. */
export class SplunkSink extends BatchingSink {
  private readonly options: SplunkSinkOptions;
  private readonly url: string;

  constructor(options: SplunkSinkOptions) {
    super(options.name ?? "splunk", options);
    this.options = options;
    this.url = `${options.url.replace(/\/+$/, "")}/services/collector/event`;
  }

  protected async send(entries: readonly LogEntry[]): Promise<void> {
    const body = entries
      .map((entry) =>
        safeStringify({
          time: entry.time.getTime() / 1000,
          ...(this.options.host === undefined ? {} : { host: this.options.host }),
          ...(this.options.index === undefined ? {} : { index: this.options.index }),
          ...(this.options.source === undefined ? {} : { source: this.options.source }),
          sourcetype: this.options.sourcetype ?? "_json",
          event: {
            ...contextFields(entry),
            message: entry.message,
            level: entry.level,
            ...(entry.name === undefined ? {} : { logger: entry.name }),
            ...(entry.error === undefined ? {} : { error: serializeError(entry.error) }),
          },
        }),
      )
      .join("\n");
    await sendHttp({
      url: this.url,
      body,
      headers: {
        "content-type": "application/json",
        authorization: `Splunk ${this.options.token}`,
      },
      timeoutMs: this.options.timeoutMs,
    });
  }
}
