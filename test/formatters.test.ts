import { describe, expect, it } from "vitest";
import type { LogEntry } from "../src/core.js";
import { ecsFormatter, logfmtFormatter, logstashFormatter } from "../src/formatters/index.js";

const error = new Error("nope");
const entry: LogEntry = {
  seq: 1,
  time: new Date("2026-10-01T05:00:00.000Z"),
  level: "error",
  message: "failed",
  name: "api",
  context: { traceId: "abc", userId: 7, note: "two words", error },
  error,
};

describe("formatters", () => {
  it("ecs maps metadata, trace ids and errors", () => {
    const doc = JSON.parse(ecsFormatter({ serviceName: "svc" })(entry)) as Record<string, unknown>;
    expect(doc).toMatchObject({
      "@timestamp": "2026-10-01T05:00:00.000Z",
      "log.level": "error",
      "log.logger": "api",
      message: "failed",
      "service.name": "svc",
      "trace.id": "abc",
      userId: 7,
      "error.type": "Error",
      "error.message": "nope",
    });
    expect(doc).not.toHaveProperty("traceId");
    expect(doc).not.toHaveProperty("error");
  });

  it("logstash emits json_event fields", () => {
    const event = JSON.parse(logstashFormatter({ type: "app", tags: ["t"] })(entry)) as Record<
      string,
      unknown
    >;
    expect(event).toMatchObject({
      "@version": "1",
      message: "failed",
      level: "error",
      logger_name: "api",
      type: "app",
      tags: ["t"],
      error: { name: "Error", message: "nope" },
    });
  });

  it("logfmt quotes values with spaces", () => {
    const line = logfmtFormatter()(entry);
    expect(line).toContain("level=error");
    expect(line).toContain('note="two words"');
    expect(line).toContain("userId=7");
    expect(line).toContain("error=nope");
  });
});
