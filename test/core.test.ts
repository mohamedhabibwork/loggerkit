import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createConsoleSink } from "../src/sinks/console.js";
import { FileSink } from "../src/sinks/file.js";
import { HttpSink } from "../src/sinks/http.js";
import { MemorySink } from "../src/sinks/memory.js";
import { jsonFormatter } from "../src/formatters/json.js";
import { prettyFormatter } from "../src/formatters/pretty.js";
import { createLogger } from "../src/factory.js";
import { Logger } from "../src/logger.js";
import { LogManager } from "../src/manager.js";
import { createCapture } from "../src/testing.js";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await (await import("node:fs/promises")).rm(dir, { recursive: true, force: true });
  }
});

describe("Logger", () => {
  it("filters below the configured level", () => {
    const capture = createCapture();
    const log = new Logger({ level: "warn", sinks: [capture.sink] });
    log.info("hidden");
    log.warn("shown");
    expect(capture.messages()).toEqual(["shown"]);
  });

  it("merges bindings and call-site fields into context", () => {
    const capture = createCapture();
    const log = new Logger({ sinks: [capture.sink], bindings: { service: "api" } });
    log.child("req", { requestId: "r1" }).info("hello", { extra: 1 });
    const entry = capture.entries[0]!;
    expect(entry.context).toEqual({ service: "api", requestId: "r1", extra: 1 });
  });

  it("assigns a name and child names are joined with ':'", () => {
    const capture = createCapture();
    const log = new Logger({ name: "app", sinks: [capture.sink] });
    log.child("auth").warn("boom");
    expect(capture.entries[0]?.name).toBe("app:auth");
  });

  it("accepts an Error in error/fatal and attaches it", () => {
    const capture = createCapture();
    const log = new Logger({ level: "trace", sinks: [capture.sink] });
    const boom = new Error("boom");
    log.error("failed", boom);
    expect(capture.entries[0]?.error).toBe(boom);
    log.fatal("dead", boom);
    expect(capture.entries[1]?.error).toBe(boom);
  });

  it("setLevel accepts strings and rejects unknown levels", () => {
    const log = new Logger({});
    expect(() => log.setLevel("loud")).toThrow(/Invalid log level/);
    log.setLevel("debug");
    expect(log.level).toBe("debug");
  });

  it("removeSink reports whether a sink was removed", () => {
    const memory = new MemorySink();
    const log = new Logger({ sinks: [memory] });
    expect(log.listSinks()).toEqual(["memory"]);
    expect(log.removeSink("memory")).toBe(true);
    expect(log.removeSink("memory")).toBe(false);
  });

  it("continues when a sink throws", () => {
    const capture = createCapture();
    const bad = {
      name: "bad",
      write(): void {
        throw new Error("sink exploded");
      },
    };
    const errors: unknown[] = [];
    const log = new Logger({ sinks: [bad, capture.sink], onError: (error) => errors.push(error) });
    log.info("hello");
    expect(capture.messages()).toEqual(["hello"]);
    expect(errors).toHaveLength(1);
  });
});

describe("sinks", () => {
  it("MemorySink keeps bounded history and supports byLevel", () => {
    const memory = new MemorySink({ maxEntries: 2 });
    const log = new Logger({ level: "trace", sinks: [memory] });
    log.trace("a");
    log.debug("b");
    log.info("c");
    expect(memory.entries().map((entry) => entry.message)).toEqual(["b", "c"]);
    expect(memory.byLevel("warn")).toEqual([]);
    memory.clear();
    expect(memory.entries()).toEqual([]);
    memory.close();
    expect(() =>
      memory.write({ seq: 0, time: new Date(), level: "info", message: "x", context: {} }),
    ).toThrow(/closed/);
  });

  it("console sink routes levels to console methods and emits NDJSON payloads", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const sink = createConsoleSink();
      const log = new Logger({ name: "app", level: "trace", sinks: [sink] });
      log.debug("dbg");
      log.info("hello", { requestId: "r1" });
      expect(debug).toHaveBeenCalledTimes(1);
      expect(info).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse(String(info.mock.calls[0]?.[0])) as Record<string, unknown>;
      expect(parsed.level).toBe("info");
      expect(parsed.message).toBe("hello");
      expect(parsed.name).toBe("app");
      expect(parsed.requestId).toBe("r1");
    } finally {
      debug.mockRestore();
      info.mockRestore();
    }
  });

  it("console sink respects minLevel", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const sink = createConsoleSink({ minLevel: "warn" });
      expect(sink.name).toBe("console");
      const log = new Logger({ level: "trace", sinks: [sink] });
      log.info("filtered");
      log.warn("shown");
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("FileSink appends NDJSON and rotates by size", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "loggerkit-"));
    tempDirs.push(dir);
    const filePath = path.join(dir, "logs", "app.log");
    const sink = new FileSink({ filePath, maxBytes: 40, maxFiles: 2 });
    const log = new Logger({ level: "trace", sinks: [sink] });
    for (let index = 0; index < 5; index += 1) {
      log.info(`message number ${index} with padding`, { index });
    }
    await sink.close();
    const rotated = await readdir(path.dirname(filePath));
    expect(rotated.some((name) => name.startsWith("app.log."))).toBe(true);
    const active = await readFile(filePath, "utf8");
    expect(active.trim().split("\n").length).toBeGreaterThan(0);
    const last = active.trim().split("\n").pop() ?? "";
    expect(() => JSON.parse(last) as Record<string, unknown>).not.toThrow();
  });

  it("HttpSink batches and swallows network errors", async () => {
    const sink = new HttpSink({ url: "http://127.0.0.1:1/ingest", batchSize: 2 });
    const log = new Logger({ level: "trace", sinks: [sink] });
    log.info("one");
    log.info("two");
    await expect(sink.flush()).resolves.toBeUndefined();
    await sink.close();
  });
});

describe("formatters", () => {
  const entry = {
    seq: 1,
    time: new Date("2026-01-01T00:00:00.000Z"),
    level: "info" as const,
    message: "hello",
    context: { requestId: "r1", error: "not-an-error" },
    name: "app",
  };

  it("jsonFormatter produces parseable NDJSON with reserved keys lifted", () => {
    const line = jsonFormatter()(entry);
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed.level).toBe("info");
    expect(parsed.requestId).toBe("r1");
    expect(parsed.name).toBe("app");
  });

  it("prettyFormatter renders a readable line with context", () => {
    const line = prettyFormatter()(entry);
    expect(line).toContain("INFO ");
    expect(line).toContain("app: hello");
    expect(line).toContain("requestId=r1");
  });
});

describe("factory and manager", () => {
  it("resolveSink rejects unknown kinds", () => {
    expect(() => createLogger({ sinks: [{ kind: "carrier-pigeon" as never }] })).toThrow(
      /Unknown sink kind/,
    );
    expect(() => createLogger({ sinks: [{ kind: "file" as never }] })).toThrow(/filePath/);
    expect(() => createLogger({ sinks: [{ kind: "http" as never }] })).toThrow(/url/);
  });

  it("createLogger accepts concrete sinks and specs", () => {
    const memory = new MemorySink();
    const logger = createLogger({ sinks: [memory, { kind: "memory", name: "second" }] });
    expect(logger.listSinks()).toEqual(["memory", "second"]);
  });

  it("LogManager caches named loggers and applies global level", () => {
    const manager = new LogManager({ sinks: [{ kind: "memory" }] });
    const a = manager.get("a");
    expect(manager.get("a")).toBe(a);
    manager.setGlobalLevel("error");
    expect(a.level).toBe("error");
    expect(manager.names()).toEqual(["a"]);
    expect(manager.get("b").level).toBe("error");
    return manager.close();
  });
});
