import { safeStringify, type LogEntry } from "../core.js";
import { toLogstashEvent, type LogstashFormatterOptions } from "../formatters/logstash.js";
import { BatchingSink, PartialBatchError, type BatchOptions } from "./batch.js";
import {
  basicAuth,
  createSocketWriter,
  sendHttp,
  type SocketOptions,
  type SocketWriter,
} from "./transport.js";

export interface LogstashSinkOptions extends BatchOptions, LogstashFormatterOptions {
  /**
   * `tcp`/`tls`: `tcp { codec => json_lines }` input.
   * `udp`: `udp { codec => json }` input (one datagram per event).
   * `http`: `http { }` input (JSON array body).
   */
  protocol: "tcp" | "tls" | "udp" | "http";
  /** Host for socket protocols. */
  host?: string;
  /** Port for socket protocols. */
  port?: number;
  /** Endpoint for `http`, e.g. `http://logstash:8080`. */
  url?: string;
  username?: string;
  password?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** TLS-only settings for `protocol: "tls"` (CA bundle, verification opt-out). */
  tls?: SocketOptions["tls"];
  name?: string;
}

/** Native Logstash sink over TCP/TLS (json_lines), UDP, or the HTTP input. */
export class LogstashSink extends BatchingSink {
  private readonly options: LogstashSinkOptions;
  private readonly socket?: SocketWriter;

  constructor(options: LogstashSinkOptions) {
    super(options.name ?? "logstash", options);
    this.options = options;
    if (options.protocol === "http") {
      if (options.url === undefined) {
        throw new TypeError('LogstashSink protocol "http" requires "url".');
      }
    } else {
      if (options.host === undefined || options.port === undefined) {
        throw new TypeError(
          `LogstashSink protocol "${options.protocol}" requires "host" and "port".`,
        );
      }
      this.socket = createSocketWriter({
        protocol: options.protocol,
        host: options.host,
        port: options.port,
        timeoutMs: options.timeoutMs,
        ...(options.tls === undefined ? {} : { tls: options.tls }),
      });
    }
  }

  protected async send(entries: readonly LogEntry[]): Promise<void> {
    const events = entries.map((entry) => toLogstashEvent(entry, this.options));
    if (this.socket === undefined) {
      const auth: Record<string, string> =
        this.options.username === undefined
          ? {}
          : { authorization: basicAuth(this.options.username, this.options.password ?? "") };
      await sendHttp({
        url: this.options.url ?? "",
        body: safeStringify(events),
        headers: { "content-type": "application/json", ...auth, ...this.options.headers },
        timeoutMs: this.options.timeoutMs,
      });
      return;
    }
    if (this.options.protocol === "udp") {
      for (const [index, event] of events.entries()) {
        try {
          await this.socket.send(safeStringify(event));
        } catch (error) {
          throw new PartialBatchError(entries.slice(index), error);
        }
      }
      return;
    }
    await this.socket.send(`${events.map((event) => safeStringify(event)).join("\n")}\n`);
  }

  protected override async dispose(): Promise<void> {
    await this.socket?.close();
  }
}
