import { createSocket } from "node:dgram";
import { createServer, type AddressInfo, type Server } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LogEntry } from "../src/core.js";
import { createLogger } from "../src/factory.js";
import { BatchingSink } from "../src/sinks/batch.js";
import { DatadogSink } from "../src/sinks/datadog.js";
import { ElasticsearchSink } from "../src/sinks/elasticsearch.js";
import { GelfSink } from "../src/sinks/gelf.js";
import { LogstashSink } from "../src/sinks/logstash.js";
import { LokiSink } from "../src/sinks/loki.js";
import { OtlpSink } from "../src/sinks/otlp.js";
import { SplunkSink } from "../src/sinks/splunk.js";
import { formatSyslog, SyslogSink } from "../src/sinks/syslog.js";

interface Captured {
  url: string;
  init: RequestInit;
}

const headersOf = (call: Captured | undefined): Record<string, string> =>
  (call?.init.headers ?? {}) as Record<string, string>;

function mockFetch(body: unknown = {}, status = 200): Captured[] {
  const calls: Captured[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status });
    }),
  );
  return calls;
}

const entry = (message: string, extra: Partial<LogEntry> = {}): LogEntry => ({
  seq: 1,
  time: new Date("2026-10-01T05:00:00.000Z"),
  level: "info",
  message,
  context: { userId: 1 },
  ...extra,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BatchingSink", () => {
  class Recorder extends BatchingSink {
    batches: string[][] = [];
    failuresLeft: number;
    constructor(failures: number, onError?: (error: unknown, dropped: number) => void) {
      super("recorder", {
        batchSize: 2,
        retries: 2,
        retryDelayMs: 0,
        flushIntervalMs: 10,
        onError,
      });
      this.failuresLeft = failures;
    }
    protected async send(entries: readonly LogEntry[]): Promise<void> {
      if (this.failuresLeft > 0) {
        this.failuresLeft -= 1;
        throw new Error("down");
      }
      this.batches.push(entries.map((item) => item.message));
    }
  }

  it("batches by size, flushes on close and retries", async () => {
    const sink = new Recorder(1);
    sink.write(entry("a"));
    sink.write(entry("b"));
    sink.write(entry("c"));
    await sink.close();
    expect(sink.batches).toEqual([["a", "b"], ["c"]]);
    expect(() => sink.write(entry("d"))).toThrow(/closed/);
  });

  it("reports dropped batches after exhausting retries", async () => {
    const dropped: number[] = [];
    const sink = new Recorder(10, (_error, count) => dropped.push(count));
    sink.write(entry("a"));
    await sink.flush();
    expect(dropped).toEqual([1]);
  });

  it("flushes on the interval timer", async () => {
    const sink = new Recorder(0);
    sink.write(entry("a"));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(sink.batches).toEqual([["a"]]);
    await sink.close();
  });
});

describe("HTTP sinks", () => {
  it("elasticsearch sends _bulk create ops with dated index and api key", async () => {
    const calls = mockFetch({ errors: false });
    const sink = new ElasticsearchSink({
      node: "https://es:9200/",
      index: "logs-{yyyy}.{MM}.{dd}",
      apiKey: "k",
      retries: 0,
    });
    sink.write(entry("hello"));
    await sink.close();
    expect(calls[0]?.url).toBe("https://es:9200/_bulk");
    expect(headersOf(calls[0]).authorization).toBe("ApiKey k");
    const [action, doc] = String(calls[0]?.init.body).trim().split("\n");
    expect(JSON.parse(action ?? "")).toEqual({ create: { _index: "logs-2026.10.01" } });
    expect(JSON.parse(doc ?? "")).toMatchObject({ message: "hello", "log.level": "info" });
  });

  it("elasticsearch treats item-level errors as failures", async () => {
    mockFetch({ errors: true, items: [{ create: { status: 400, error: { reason: "mapping" } } }] });
    const errors: unknown[] = [];
    const sink = new ElasticsearchSink({
      node: "http://es",
      retries: 0,
      onError: (error) => errors.push(error),
    });
    sink.write(entry("x"));
    await sink.close();
    expect(String(errors[0])).toMatch(/mapping/);
  });

  it("loki groups streams by labels with nanosecond timestamps", async () => {
    const calls = mockFetch();
    const sink = new LokiSink({ url: "http://loki:3100", labels: { app: "api" }, tenantId: "t" });
    sink.write(entry("one"));
    sink.write(entry("two", { level: "warn" }));
    await sink.close();
    const body = JSON.parse(String(calls[0]?.init.body)) as {
      streams: Array<{ stream: Record<string, string>; values: string[][] }>;
    };
    expect(calls[0]?.url).toBe("http://loki:3100/loki/api/v1/push");
    expect(body.streams).toHaveLength(2);
    expect(body.streams[0]?.stream).toEqual({ app: "api", level: "info" });
    expect(body.streams[0]?.values[0]?.[0]).toBe("1790830800000000000");
    expect(headersOf(calls[0])["x-scope-orgid"]).toBe("t");
  });

  it("datadog posts to the site intake with the api key", async () => {
    const calls = mockFetch();
    const sink = new DatadogSink({
      apiKey: "dd",
      site: "datadoghq.eu",
      service: "api",
      tags: ["env:prod"],
    });
    sink.write(entry("x", { level: "fatal" }));
    await sink.close();
    expect(calls[0]?.url).toBe("https://http-intake.logs.datadoghq.eu/api/v2/logs");
    const [log] = JSON.parse(String(calls[0]?.init.body)) as Array<Record<string, unknown>>;
    expect(log).toMatchObject({
      status: "critical",
      service: "api",
      ddtags: "env:prod",
      userId: 1,
    });
  });

  it("otlp builds resourceLogs with severity and typed attributes", async () => {
    const calls = mockFetch();
    const sink = new OtlpSink({ endpoint: "http://otel:4318", serviceName: "api" });
    sink.write(
      entry("x", {
        level: "error",
        context: { count: 2, ratio: 0.5, ok: true, traceId: "4bf92f3577b34da6a3ce929d0e0e4736" },
      }),
    );
    await sink.close();
    expect(calls[0]?.url).toBe("http://otel:4318/v1/logs");
    const body = JSON.parse(String(calls[0]?.init.body)) as {
      resourceLogs: Array<{
        resource: unknown;
        scopeLogs: Array<{ logRecords: Array<Record<string, unknown>> }>;
      }>;
    };
    const record = body.resourceLogs[0]?.scopeLogs[0]?.logRecords[0];
    expect(record).toMatchObject({
      severityNumber: 17,
      severityText: "ERROR",
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    });
    expect(record?.attributes).toEqual([
      { key: "count", value: { intValue: "2" } },
      { key: "ratio", value: { doubleValue: 0.5 } },
      { key: "ok", value: { boolValue: true } },
    ]);
  });

  it("splunk sends HEC events with the token", async () => {
    const calls = mockFetch();
    const sink = new SplunkSink({ url: "https://splunk:8088", token: "tok", index: "main" });
    sink.write(entry("x"));
    await sink.close();
    expect(calls[0]?.url).toBe("https://splunk:8088/services/collector/event");
    expect(headersOf(calls[0]).authorization).toBe("Splunk tok");
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      index: "main",
      event: { message: "x" },
    });
  });

  it("logstash http posts a JSON array; gelf http posts one message", async () => {
    const calls = mockFetch();
    const logstash = new LogstashSink({ protocol: "http", url: "http://ls:8080" });
    logstash.write(entry("a"));
    await logstash.close();
    expect(JSON.parse(String(calls[0]?.init.body))).toHaveLength(1);
    const gelf = new GelfSink({
      protocol: "http",
      url: "http://graylog:12201/gelf",
      source: "web",
    });
    gelf.write(entry("b"));
    await gelf.close();
    expect(JSON.parse(String(calls[1]?.init.body))).toMatchObject({
      version: "1.1",
      host: "web",
      short_message: "b",
      level: 6,
      _userId: 1,
    });
  });

  it("validates protocol-specific options", () => {
    expect(() => new LogstashSink({ protocol: "http" })).toThrow(/url/);
    expect(() => new LogstashSink({ protocol: "tcp" })).toThrow(/host/);
    expect(() => new GelfSink({ protocol: "udp" })).toThrow(/host/);
  });
});

describe("socket sinks", () => {
  let server: Server | undefined;
  afterEach(() => {
    server?.close();
  });

  it("logstash tcp writes json_lines", async () => {
    const received: string[] = [];
    server = createServer((socket) => socket.on("data", (data) => received.push(String(data))));
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const sink = new LogstashSink({ protocol: "tcp", host: "127.0.0.1", port });
    sink.write(entry("a"));
    sink.write(entry("b"));
    await sink.close();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const lines = received
      .join("")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { message: string });
    expect(lines.map((line) => line.message)).toEqual(["a", "b"]);
  });

  it("syslog udp sends RFC 5424 messages", async () => {
    const udp = createSocket("udp4");
    const received = new Promise<string>((resolve) =>
      udp.once("message", (msg) => resolve(String(msg))),
    );
    await new Promise<void>((resolve) => udp.bind(0, "127.0.0.1", resolve));
    const sink = new SyslogSink({
      host: "127.0.0.1",
      port: udp.address().port,
      appName: "api",
      facility: 16,
    });
    sink.write(entry("hello"));
    await sink.close();
    expect(await received).toBe(
      '<134>1 2026-10-01T05:00:00.000Z - api - info [meta@32473 userId="1"] hello',
    );
    udp.close();
  });

  it("formatSyslog escapes structured data and handles empty context", () => {
    expect(formatSyslog(entry("m", { context: { q: 'a"]b' } }))).toContain('q="a\\"\\]b"');
    expect(formatSyslog(entry("m", { context: {}, level: "error" }))).toMatch(/^<11>1 .* - m$/);
  });
});

describe("factory", () => {
  it("resolves native sink specs", async () => {
    const calls = mockFetch();
    const logger = createLogger({
      sinks: [{ kind: "loki", options: { url: "http://loki:3100", batchSize: 1 } }],
    });
    expect(logger.listSinks()).toEqual(["loki"]);
    logger.info("via factory");
    await logger.close();
    expect(calls).toHaveLength(1);
  });
});
