import { afterEach, describe, expect, it, vi } from "vitest";
import { safeStringify, type LogEntry } from "../src/core.js";
import { createMemoryLogger } from "../src/factory.js";
import { redact } from "../src/processors.js";
import { BatchingSink, PartialBatchError } from "../src/sinks/batch.js";
import { ElasticsearchSink } from "../src/sinks/elasticsearch.js";
import { LokiSink } from "../src/sinks/loki.js";
import { sendHttp, TransportError } from "../src/sinks/transport.js";

const entry = (message: string, context: Record<string, unknown> = {}): LogEntry => ({
  seq: 1,
  time: new Date("2026-10-01T05:00:00.000Z"),
  level: "info",
  message,
  context,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("transport", () => {
  it("moves URL credentials into a header and never leaks them in errors", async () => {
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        seen.push({ url, headers: init.headers as Record<string, string> });
        throw new TypeError(`cannot fetch ${url}`);
      }),
    );
    const error = await sendHttp({ url: "https://elastic:s3cret@es:9200/_bulk", body: "" }).catch(
      (caught: unknown) => caught,
    );
    expect(seen[0]?.url).toBe("https://es:9200/_bulk");
    expect(seen[0]?.headers.authorization).toBe(`Basic ${btoa("elastic:s3cret")}`);
    expect(error).toBeInstanceOf(TransportError);
    expect(String(error)).not.toContain("s3cret");
    expect((error as TransportError).retryable).toBe(true);
  });

  it("marks 4xx as non-retryable and 429/5xx as retryable", () => {
    expect(new TransportError("x", 401).retryable).toBe(false);
    expect(new TransportError("x", 429).retryable).toBe(true);
    expect(new TransportError("x", 503).retryable).toBe(true);
  });
});

describe("batching", () => {
  class Flaky extends BatchingSink {
    sent: string[] = [];
    calls = 0;
    constructor(
      private readonly behavior: (calls: number, entries: readonly LogEntry[]) => void,
      onError: (error: unknown, dropped: number) => void = () => {},
    ) {
      super("flaky", { batchSize: 10, retries: 3, retryDelayMs: 0, onError });
    }
    protected async send(entries: readonly LogEntry[]): Promise<void> {
      this.calls += 1;
      this.behavior(this.calls, entries);
      this.sent.push(...entries.map((item) => item.message));
    }
  }

  it("retries only the undelivered remainder of a partial batch", async () => {
    const sink = new Flaky((calls, entries) => {
      if (calls === 1) {
        throw new PartialBatchError(entries.slice(1), new Error("socket reset"));
      }
    });
    sink.write(entry("a"));
    sink.write(entry("b"));
    await sink.flush();
    expect(sink.sent).toEqual(["b"]);
    expect(sink.calls).toBe(2);
  });

  it("does not retry permanent failures", async () => {
    const dropped: number[] = [];
    const sink = new Flaky(
      () => {
        throw new TransportError("bad key", 401);
      },
      (_error, count) => dropped.push(count),
    );
    sink.write(entry("a"));
    await sink.flush();
    expect(sink.calls).toBe(1);
    expect(dropped).toEqual([1]);
  });

  it("keeps working when onError throws and close is idempotent", async () => {
    let fail = true;
    const sink = new Flaky(
      () => {
        if (fail) {
          throw new TransportError("bad", 400);
        }
      },
      () => {
        throw new Error("handler bug");
      },
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    sink.write(entry("a"));
    await expect(sink.flush()).resolves.toBeUndefined();
    fail = false;
    sink.write(entry("b"));
    await Promise.all([sink.close(), sink.close()]);
    expect(sink.sent).toEqual(["b"]);
    warn.mockRestore();
  });
});

describe("elasticsearch partial bulk failures", () => {
  it("retries only 429 items and reports 4xx items once", async () => {
    const bodies: string[] = [];
    const responses = [
      {
        errors: true,
        items: [
          { create: { status: 201 } },
          { create: { status: 429, error: { reason: "busy" } } },
          { create: { status: 400, error: { reason: "mapping" } } },
        ],
      },
      { errors: false, items: [{ create: { status: 201 } }] },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(String(init.body));
        return new Response(JSON.stringify(responses.shift()), { status: 200 });
      }),
    );
    const reported: number[] = [];
    const sink = new ElasticsearchSink({
      node: "http://es",
      retryDelayMs: 0,
      onError: (_error, count) => reported.push(count),
    });
    sink.write(entry("ok"));
    sink.write(entry("busy"));
    sink.write(entry("bad"));
    await sink.close();
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toContain('"busy"');
    expect(bodies[1]).not.toContain('"ok"');
    expect(reported).toEqual([1]);
  });
});

describe("serialization and validation", () => {
  it("safeStringify handles cycles, bigint and errors", () => {
    const cyclic: Record<string, unknown> = { id: 1n };
    cyclic.self = cyclic;
    expect(JSON.parse(safeStringify(cyclic))).toEqual({ id: "1", self: "[Circular]" });
    expect(JSON.parse(safeStringify({ e: new Error("x") })).e.message).toBe("x");
  });

  it("loki sanitizes label names and skips object values", async () => {
    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(String(init.body));
        return new Response("", { status: 204 });
      }),
    );
    const sink = new LokiSink({
      url: "http://loki",
      labels: { "service.name": "api" },
      labelKeys: ["tenant-id", "meta"],
    });
    sink.write(entry("x", { "tenant-id": "t1", meta: { a: 1 } }));
    await sink.close();
    const stream = (JSON.parse(bodies[0] ?? "{}") as { streams: Array<{ stream: unknown }> })
      .streams[0]?.stream;
    expect(stream).toEqual({ service_name: "api", level: "info", tenant_id: "t1" });
  });

  it("redact descends into arrays", () => {
    const { logger, memory } = createMemoryLogger({ processors: [redact({ keys: ["password"] })] });
    logger.info("users", { users: [{ name: "a", password: "x" }] });
    expect(memory.entries()[0]?.context).toEqual({
      users: [{ name: "a", password: "[REDACTED]" }],
    });
  });

  it("a throwing context provider never reaches the caller", () => {
    const errors: string[] = [];
    const { logger, memory } = createMemoryLogger({
      contextProvider: () => {
        throw new Error("als broken");
      },
      onError: (_error, source) => errors.push(source),
    });
    expect(() => logger.info("still logged")).not.toThrow();
    expect(memory.entries()).toHaveLength(1);
    expect(errors).toEqual(["contextProvider"]);
  });
});
