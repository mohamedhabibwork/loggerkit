import { contextFields, safeStringify, syslogSeverity, type LogEntry } from "../core.js";
import { BatchingSink, PartialBatchError, type BatchOptions } from "./batch.js";
import { createSocketWriter, type SocketWriter } from "./transport.js";

export interface SyslogSinkOptions extends BatchOptions {
  host: string;
  /** Defaults to 514 (udp/tcp) or 6514 (tls). */
  port?: number;
  /** Defaults to `udp`. TCP/TLS use RFC 6587 octet-counting framing. */
  protocol?: "udp" | "tcp" | "tls";
  /** Facility code 0-23; defaults to 1 (user). 16-23 = local0-local7. */
  facility?: number;
  /** APP-NAME; defaults to the logger name or `loggerkit`. */
  appName?: string;
  /** HOSTNAME field; defaults to `-` (nil). */
  hostname?: string;
  timeoutMs?: number;
  name?: string;
}

/** Native RFC 5424 syslog sink (rsyslog, syslog-ng, Papertrail, journald via udp). */
export class SyslogSink extends BatchingSink {
  private readonly options: SyslogSinkOptions;
  private readonly socket: SocketWriter;
  private readonly framed: boolean;

  constructor(options: SyslogSinkOptions) {
    super(options.name ?? "syslog", { batchSize: 50, flushIntervalMs: 500, ...options });
    const protocol = options.protocol ?? "udp";
    this.options = options;
    this.framed = protocol !== "udp";
    this.socket = createSocketWriter({
      protocol,
      host: options.host,
      port: options.port ?? (protocol === "tls" ? 6514 : 514),
      timeoutMs: options.timeoutMs,
    });
  }

  protected async send(entries: readonly LogEntry[]): Promise<void> {
    for (const [index, entry] of entries.entries()) {
      const message = formatSyslog(entry, this.options);
      const payload = this.framed
        ? `${new TextEncoder().encode(message).length} ${message}`
        : message;
      try {
        await this.socket.send(payload);
      } catch (error) {
        throw new PartialBatchError(entries.slice(index), error);
      }
    }
  }

  protected override async dispose(): Promise<void> {
    await this.socket.close();
  }
}

/** Renders one RFC 5424 message; context goes into structured data `[meta@32473 ...]`. */
export function formatSyslog(entry: LogEntry, options: Partial<SyslogSinkOptions> = {}): string {
  const facility = Math.min(23, Math.max(0, options.facility ?? 1));
  const priority = facility * 8 + syslogSeverity(entry.level);
  const app = sanitize(options.appName ?? entry.name ?? "loggerkit", 48);
  const host = sanitize(options.hostname ?? "-", 255);
  const fields = contextFields(entry);
  if (entry.error !== undefined) {
    fields.error = entry.error.message;
  }
  const params = Object.entries(fields)
    .map(([key, value]) => `${sanitize(key, 32).replace(/[= \]"]/g, "_")}="${escapeParam(value)}"`)
    .join(" ");
  const structured = params === "" ? "-" : `[meta@32473 ${params}]`;
  return `<${priority}>1 ${entry.time.toISOString()} ${host} ${app} - ${entry.level} ${structured} ${entry.message}`;
}

function sanitize(value: string, max: number): string {
  const printable = value.replace(/[^\x21-\x7e]/g, "_").slice(0, max);
  return printable === "" ? "-" : printable;
}

function escapeParam(value: unknown): string {
  const text = typeof value === "string" ? value : safeStringify(value);
  return text.replace(/[\\"\]]/g, (char) => `\\${char}`);
}
