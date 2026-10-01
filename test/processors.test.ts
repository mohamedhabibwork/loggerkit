import { describe, expect, it } from "vitest";
import { createLogContext } from "../src/context.js";
import { createMemoryLogger } from "../src/factory.js";
import {
  DEFAULT_REDACT_KEYS,
  enrich,
  minLevel,
  rateLimit,
  redact,
  sample,
} from "../src/processors.js";

describe("redact", () => {
  it("censors keys at any depth without mutating the input", () => {
    const { logger, memory } = createMemoryLogger({
      processors: [redact({ keys: DEFAULT_REDACT_KEYS })],
    });
    const fields = { user: { name: "a", Password: "p" }, authorization: "Bearer x" };
    logger.info("login", fields);
    expect(memory.entries()[0]?.context).toEqual({
      user: { name: "a", Password: "[REDACTED]" },
      authorization: "[REDACTED]",
    });
    expect(fields.user.Password).toBe("p");
  });

  it("supports dotted paths, wildcards and removal", () => {
    const { logger, memory } = createMemoryLogger({
      processors: [redact({ paths: ["req.headers.*", "card"], remove: true })],
    });
    logger.info("req", { req: { headers: { a: "1", b: "2" }, url: "/" }, card: "4111" });
    expect(memory.entries()[0]?.context).toEqual({ req: { headers: {}, url: "/" } });
  });
});

describe("sample / rateLimit / enrich / minLevel", () => {
  it("samples by level with an injectable random source", () => {
    const values = [0.1, 0.9];
    const { logger, memory } = createMemoryLogger({
      level: "debug",
      processors: [sample({ rates: { debug: 0.5 }, random: () => values.shift() ?? 0 })],
    });
    logger.debug("kept");
    logger.debug("dropped");
    logger.info("always");
    expect(memory.entries().map((entry) => entry.message)).toEqual(["kept", "always"]);
  });

  it("rate limits per key per window and exempts errors", () => {
    let now = 0;
    const { logger, memory } = createMemoryLogger({
      processors: [rateLimit({ limit: 2, windowMs: 1000, now: () => now })],
    });
    for (let index = 0; index < 5; index += 1) {
      logger.info("noisy");
    }
    logger.error("boom");
    logger.error("boom");
    logger.error("boom");
    now = 1000;
    logger.info("noisy");
    expect(memory.entries().filter((entry) => entry.message === "noisy")).toHaveLength(3);
    expect(memory.entries().filter((entry) => entry.message === "boom")).toHaveLength(3);
  });

  it("enriches under call-site fields and filters by level", () => {
    const { logger, memory } = createMemoryLogger({
      level: "trace",
      processors: [enrich({ service: "api", region: "eu" }), minLevel("info")],
    });
    logger.debug("hidden");
    logger.info("shown", { region: "us" });
    expect(memory.entries()).toHaveLength(1);
    expect(memory.entries()[0]?.context).toEqual({ service: "api", region: "us" });
  });

  it("drops the entry and reports when a processor throws", () => {
    const errors: string[] = [];
    const { logger, memory } = createMemoryLogger({
      processors: [
        () => {
          throw new Error("bad processor");
        },
      ],
      onError: (_error, sink) => errors.push(sink),
    });
    logger.info("x");
    expect(memory.entries()).toHaveLength(0);
    expect(errors).toEqual(["processor"]);
  });
});

describe("logger features", () => {
  it("merges async context under call-site fields and keeps it in children", async () => {
    const context = createLogContext();
    const { logger, memory } = createMemoryLogger({ contextProvider: context.provider });
    await context.run({ requestId: "r1", user: "a" }, async () => {
      await Promise.resolve();
      context.assign({ tenant: "t1" });
      logger.child("db").info("query", { user: "b" });
    });
    logger.info("outside");
    expect(memory.entries()[0]?.context).toEqual({ requestId: "r1", user: "b", tenant: "t1" });
    expect(memory.entries()[1]?.context).toEqual({});
  });

  it("times operations and exposes isLevelEnabled", () => {
    const { logger, memory } = createMemoryLogger({ level: "debug" });
    const end = logger.time("work");
    const duration = end({ rows: 3 });
    expect(duration).toBeGreaterThanOrEqual(0);
    expect(memory.entries()[0]?.context).toMatchObject({ rows: 3, durationMs: duration });
    expect(logger.isLevelEnabled("trace")).toBe(false);
    expect(logger.isLevelEnabled("warn")).toBe(true);
  });
});
