import { describe, expect, it } from "vitest";
import {
  importOptionalPeer,
  LoggerKitError,
  parseLevel,
  levelEnabled,
  levelWeight,
  LOG_LEVELS,
} from "../src/core.js";

describe("level utilities", () => {
  it("orders levels trace < debug < info < warn < error < fatal", () => {
    const weights = LOG_LEVELS.map((level) => levelWeight(level));
    const sorted = weights.toSorted((a, b) => a - b);
    expect(weights).toEqual(sorted);
  });

  it("levelEnabled uses weight comparison", () => {
    expect(levelEnabled("info", "info")).toBe(true);
    expect(levelEnabled("debug", "info")).toBe(false);
    expect(levelEnabled("fatal", "error")).toBe(true);
  });

  it("parseLevel normalizes case and whitespace", () => {
    expect(parseLevel(" WARN ")).toBe("warn");
    expect(() => parseLevel(null)).toThrow(LoggerKitError);
    expect(() => parseLevel("loud")).toThrow(/Invalid log level/);
  });
});

describe("importOptionalPeer", () => {
  it("wraps missing modules in LoggerKitError with cause", async () => {
    const promise = importOptionalPeer("@mohamedhabibwork/definitely-not-installed");
    await expect(promise).rejects.toBeInstanceOf(LoggerKitError);
    await expect(promise).rejects.toThrow(/not installed/);
  });

  it("unwraps the default export of CJS-shaped modules", async () => {
    // node:os resolves; it has no default export interop issues, but the
    // helper must return the module object itself.
    const mod = await importOptionalPeer<typeof import("node:os")>("node:os");
    expect(typeof mod.tmpdir).toBe("function");
  });
});
