import { safeStringify, contextFields, syslogSeverity, type LogEntry } from "../core.js";
import { BatchingSink, PartialBatchError, type BatchOptions } from "./batch.js";
import {
  createSocketWriter,
  type SocketOptions,
  type SocketWriter,
  sendHttp,
} from "./transport.js";

export interface GelfSinkOptions extends BatchOptions {
  /** `udp` (uncompressed, ≤ 8192 bytes), `tcp`/`tls` (null-delimited) or `http`. */
  protocol: "udp" | "tcp" | "tls" | "http";
  host?: string;
  /** Defaults to 12201. */
  port?: number;
  /** For `http`: e.g. `http://graylog:12201/gelf`. */
  url?: string;
  /** GELF `host` field (source); defaults to `loggerkit`. */
  source?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** TLS-only settings for `protocol: "tls"` (CA bundle, verification opt-out). */
  tls?: SocketOptions["tls"];
  name?: string;
}

const GELF_UDP_MAX_BYTES = 8192;
/** GELF requires additional fields to be `_`-prefixed. */
const EXTRA = "_";

/** Native Graylog GELF 1.1 sink. */
export class GelfSink extends BatchingSink {
  private readonly options: GelfSinkOptions;
  private readonly socket?: SocketWriter;

  constructor(options: GelfSinkOptions) {
    super(options.name ?? "gelf", options);
    this.options = options;
    if (options.protocol === "http") {
      if (options.url === undefined) {
        throw new TypeError('GelfSink protocol "http" requires "url".');
      }
    } else {
      if (options.host === undefined) {
        throw new TypeError(`GelfSink protocol "${options.protocol}" requires "host".`);
      }
      this.socket = createSocketWriter({
        protocol: options.protocol,
        host: options.host,
        port: options.port ?? 12201,
        timeoutMs: options.timeoutMs,
        ...(options.tls === undefined ? {} : { tls: options.tls }),
      });
    }
  }

  protected async send(entries: readonly LogEntry[]): Promise<void> {
    for (const [index, entry] of entries.entries()) {
      try {
        await this.sendOne(entry);
      } catch (error) {
        throw new PartialBatchError(entries.slice(index), error);
      }
    }
  }

  private async sendOne(entry: LogEntry): Promise<void> {
    const source = this.options.source ?? "loggerkit";
    if (this.socket === undefined) {
      await sendHttp({
        url: this.options.url ?? "",
        body: safeStringify(toGelf(entry, source)),
        headers: { "content-type": "application/json", ...this.options.headers },
        timeoutMs: this.options.timeoutMs,
      });
    } else if (this.options.protocol === "udp") {
      await this.socket.send(fitUdp(entry, source));
    } else {
      await this.socket.send(`${safeStringify(toGelf(entry, source))}\0`);
    }
  }

  protected override async dispose(): Promise<void> {
    await this.socket?.close();
  }
}

/** GELF 1.1 payload; context becomes `_`-prefixed additional fields. */
export function toGelf(entry: LogEntry, source: string): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    version: "1.1",
    host: source,
    short_message: entry.message,
    timestamp: entry.time.getTime() / 1000,
    level: syslogSeverity(entry.level),
  };
  payload[`${EXTRA}level_name`] = entry.level;
  if (entry.name !== undefined) {
    payload[`${EXTRA}logger`] = entry.name;
  }
  for (const [key, value] of Object.entries(contextFields(entry))) {
    const field = `${EXTRA}${key.replace(/[^\w.-]/g, "_")}`;
    if (field !== `${EXTRA}id`) {
      payload[field] = typeof value === "object" && value !== null ? safeStringify(value) : value;
    }
  }
  if (entry.error !== undefined) {
    payload.full_message = entry.error.stack ?? entry.error.message;
    payload[`${EXTRA}error_type`] = entry.error.name;
  }
  return payload;
}

const encoder = new TextEncoder();

/** Keeps UDP datagrams ≤ 8 KB by dropping fields, then shortening the message by bytes. */
function fitUdp(entry: LogEntry, source: string): string {
  const full = safeStringify(toGelf(entry, source));
  if (encoder.encode(full).length <= GELF_UDP_MAX_BYTES) {
    return full;
  }
  const minimal = toGelf({ ...entry, context: {}, error: undefined }, source);
  minimal[`${EXTRA}truncated`] = true;
  let message = entry.message;
  for (;;) {
    const payload = safeStringify({ ...minimal, short_message: message });
    const overflow = encoder.encode(payload).length - GELF_UDP_MAX_BYTES;
    if (overflow <= 0 || message.length === 0) {
      return payload;
    }
    message = message.slice(0, Math.max(0, message.length - overflow - 1));
  }
}
