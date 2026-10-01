import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { captureConsole } from "../src/adapters/console.js";
import { createConsolaReporter } from "../src/adapters/consola.js";
import { createDebugLog } from "../src/adapters/debug.js";
import { expressLogger } from "../src/adapters/express.js";
import { toFastifyLogger } from "../src/adapters/fastify.js";
import { NestLoggerService } from "../src/adapters/nestjs.js";
import { createPinoDestination } from "../src/adapters/pino.js";
import type { KitLogger } from "../src/core.js";
import { createMemoryLogger } from "../src/factory.js";

describe("pino destination", () => {
  it("maps pino NDJSON lines to entries", () => {
    const { logger, memory } = createMemoryLogger({ level: "trace" });
    const dest = createPinoDestination(logger);
    dest.write(
      `${JSON.stringify({ level: 50, time: 1, pid: 1, hostname: "h", msg: "bad", reqId: 9, err: { type: "TypeError", message: "x", stack: "s" } })}\n`,
    );
    dest.write("not json\n");
    const [first, second] = memory.entries();
    expect(first).toMatchObject({ level: "error", message: "bad", context: { reqId: 9 } });
    expect(first?.error?.name).toBe("TypeError");
    expect(second).toMatchObject({ level: "info", message: "not json" });
  });
});

describe("consola / debug", () => {
  it("consola reporter maps numeric levels and errors", () => {
    const { logger, memory } = createMemoryLogger({ level: "trace" });
    const reporter = createConsolaReporter(logger);
    reporter.log({ level: 1, type: "warn", tag: "db", args: ["slow", { ms: 5 }] });
    reporter.log({ level: 0, type: "fatal", args: [new Error("down")] });
    expect(memory.entries()[0]).toMatchObject({
      level: "warn",
      message: 'slow {"ms":5}',
      context: { tag: "db" },
    });
    expect(memory.entries()[1]?.level).toBe("fatal");
    expect(memory.entries()[1]?.error?.message).toBe("down");
  });

  it("debug log keeps the namespace and strips ansi", () => {
    const { logger, memory } = createMemoryLogger({ level: "debug" });
    const log = createDebugLog(logger);
    log.call({ namespace: "express:router" }, "\u001b[36mdispatching\u001b[0m");
    expect(memory.entries()[0]).toMatchObject({
      message: "dispatching",
      context: { namespace: "express:router" },
    });
  });
});

describe("express", () => {
  it("attaches req.log and logs completion with status-based level", () => {
    const { logger, memory } = createMemoryLogger();
    const middleware = expressLogger(logger, { generateId: () => "gen" });
    const headers: Record<string, string> = {};
    const res = Object.assign(new EventEmitter(), {
      statusCode: 503,
      setHeader: (name: string, value: string) => {
        headers[name] = value;
      },
    });
    const req: Parameters<typeof middleware>[0] = {
      method: "GET",
      url: "/x",
      headers: { "x-request-id": "abc" },
    };
    let called = false;
    middleware(req, res, () => {
      called = true;
    });
    res.emit("finish");
    res.emit("close");
    expect(called).toBe(true);
    expect(headers["x-request-id"]).toBe("abc");
    expect(memory.entries()).toHaveLength(1);
    expect(memory.entries()[0]).toMatchObject({
      level: "error",
      message: "GET /x 503",
      context: { requestId: "abc", method: "GET", path: "/x", status: 503 },
    });
  });
});

describe("fastify", () => {
  it("behaves like a pino logger", () => {
    const { logger, memory } = createMemoryLogger({ level: "trace" });
    const fastify = toFastifyLogger(logger);
    fastify.info({ reqId: "1" }, "incoming %s", "GET");
    fastify.error(new Error("boom"));
    const child = fastify.child({ plugin: "auth" }, { level: "warn" });
    child.info("hidden");
    child.warn("shown");
    fastify.silent("nothing");
    expect(memory.entries().map((entry) => entry.message)).toEqual([
      "incoming GET",
      "boom",
      "shown",
    ]);
    expect(memory.entries()[0]?.context).toEqual({ reqId: "1" });
    expect(memory.entries()[2]?.context).toEqual({ plugin: "auth" });
    expect(fastify.level).toBe("trace");
  });
});

describe("nestjs", () => {
  it("maps Nest calls, context and stacks", () => {
    const { logger, memory } = createMemoryLogger({ level: "trace" });
    const nest = new NestLoggerService(logger);
    nest.log("started", "Bootstrap");
    nest.error("failed", "Error: x\n    at y", "UsersService");
    nest.error("plain", "OnlyContext");
    nest.setLogLevels(["warn", "error"]);
    nest.debug("ignored");
    expect(memory.entries()[0]).toMatchObject({
      level: "info",
      message: "started",
      context: { context: "Bootstrap" },
    });
    expect(memory.entries()[1]?.context).toMatchObject({
      context: "UsersService",
      stack: "Error: x\n    at y",
    });
    expect(memory.entries()[2]?.context).toEqual({ context: "OnlyContext" });
    expect(memory.entries()).toHaveLength(3);
  });
});

describe("console capture", () => {
  it("routes console calls and restores originals", () => {
    const { logger, memory } = createMemoryLogger({ level: "trace" });
    const calls: unknown[][] = [];
    const fake = {
      log: (...args: unknown[]) => calls.push(args),
      info() {},
      warn() {},
      error() {},
      debug() {},
      trace() {},
    } as unknown as Console;
    const original = fake.log;
    const restore = captureConsole(logger, fake);
    fake.warn("careful", { a: 1 });
    restore();
    expect(fake.log).toBe(original);
    expect(memory.entries()[0]).toMatchObject({ level: "warn", message: 'careful {"a":1}' });
  });
});

describe("KitLogger contract", () => {
  it("is satisfied by Logger", () => {
    const { logger } = createMemoryLogger();
    const kit: KitLogger = logger;
    expect(typeof kit.error).toBe("function");
  });
});
