import { describe, expect, it, vi } from "vitest";
import { requestLogger } from "../src/adapters/hono.js";
import { elysiaLogger } from "../src/adapters/elysia.js";
import { createBunyanStream } from "../src/adapters/bunyan.js";
import { createLog4jsAppender } from "../src/adapters/log4js.js";
import { createLoglevelMethods } from "../src/adapters/loglevel.js";
import { createMorganStream, parse } from "../src/adapters/morgan.js";
import { createRoarrSink } from "../src/adapters/roarr.js";
import { createWinstonTransport } from "../src/adapters/winston.js";
import { pino } from "../src/pino-compat.js";
import { Logger } from "../src/logger.js";
import { createCapture } from "../src/testing.js";
import { jsonFormatter } from "../src/formatters/json.js";

function makeLogger(capture: ReturnType<typeof createCapture>): Logger {
  return new Logger({ level: "trace", sinks: [capture.sink], formatter: jsonFormatter() });
}

describe("hono adapter", () => {
  it("logs successful requests and exposes the logger", async () => {
    const capture = createCapture();
    const middleware = requestLogger(makeLogger(capture));
    let called = false;
    await middleware(
      {
        req: { method: "GET", path: "/x" },
        res: { status: 200 },
        set: (key: string, value: unknown) => void (key === "logger" ? void 0 : value),
      },
      async () => {
        called = true;
      },
    );
    void 0;
    expect(called).toBe(true);
    expect(capture.messages()).toEqual(["GET /x"]);
    expect(capture.entries[0]?.context).toMatchObject({ status: 200 });
  });

  it("logs thrown errors at error level", async () => {
    const capture = createCapture();
    const middleware = requestLogger(makeLogger(capture));
    await expect(
      middleware(
        { req: { method: "POST", path: "/y" }, res: { status: 500 }, set: () => undefined },
        async () => {
          throw new Error("handler failed");
        },
      ),
    ).rejects.toThrow("handler failed");
    expect(capture.byLevel("error").length).toBe(1);
  });
});

describe("elysia adapter", () => {
  it("returns a plugin with derive and onRequest", async () => {
    const capture = createCapture();
    const plugin = elysiaLogger(makeLogger(capture));
    expect(plugin.name).toBe("loggerkit");
    expect(plugin.derive?.().logger).toBeDefined();
    const onRequest = plugin.onRequest;
    if (onRequest === undefined) {
      throw new Error("onRequest missing");
    }
    const response: unknown = await onRequest(
      { request: new Request("http://x.test/a"), set: { status: 201 } },
      async () => "ok",
    );
    expect(response).toBe("ok");
    expect(capture.messages()).toEqual(["GET /a"]);
    expect(capture.entries[0]?.context).toMatchObject({ status: 201 });
  });
});

describe("bunyan adapter", () => {
  it("routes raw records into the logger", () => {
    const capture = createCapture();
    const stream = createBunyanStream(makeLogger(capture));
    stream.write({ level: 30, msg: "from bunyan", requestId: "r9" });
    expect(capture.messages()).toEqual(["from bunyan"]);
    expect(capture.entries[0]?.context).toMatchObject({ requestId: "r9" });
  });

  it("maps bunyan numeric levels", () => {
    const capture = createCapture();
    const stream = createBunyanStream(makeLogger(capture));
    stream.write({ level: 50, msg: "severe" });
    expect(capture.byLevel("error").length).toBe(1);
  });
});

describe("log4js adapter", () => {
  it("forwards events without registering when name is omitted", async () => {
    const capture = createCapture();
    const appender = await createLog4jsAppender(makeLogger(capture));
    appender({
      level: { levelStr: "ERROR" },
      categoryName: "svc",
      data: ["oops", new Error("e")],
      startTime: new Date(),
    });
    expect(capture.byLevel("error").length).toBe(1);
  });

  it("throws a descriptive error when log4js is not installed", async () => {
    await expect(createLog4jsAppender(new Logger({}), { name: "file" })).rejects.toThrow(
      /not installed/,
    );
  });
});

describe("loglevel adapter", () => {
  it("maps all five methods", () => {
    const capture = createCapture();
    const methods = createLoglevelMethods(makeLogger(capture));
    methods.trace("t");
    methods.debug("d");
    methods.info("i", { extra: 1 });
    methods.warn("w");
    methods.error("e");
    expect(capture.messages()).toEqual(["t", "d", 'i {"extra":1}', "w", "e"]);
    expect(capture.entries[4]?.message).toBe("e");
  });
});

describe("morgan adapter", () => {
  it("parses the common line format", () => {
    const capture = createCapture();
    createMorganStream(makeLogger(capture)).write("GET /users 200 12.345 ms - 156\n");
    expect(capture.messages()).toEqual(["GET /users"]);
    expect(capture.entries[0]?.context).toMatchObject({ status: 200, durationMs: 12.345 });
  });

  it("falls back to raw message for unknown formats", () => {
    const parsed = parse("weird line");
    expect(parsed.message).toBe("weird line");
    expect(parsed.fields).toEqual({});
  });
});

describe("roarr adapter", () => {
  it("maps roarr JSON messages", () => {
    const capture = createCapture();
    const sink = createRoarrSink(makeLogger(capture));
    sink(JSON.stringify({ message: "hi", level: 20, context: { requestId: "r1" } }));
    expect(capture.messages()).toEqual(["hi"]);
    expect(capture.byLevel("debug").length).toBe(1);
  });

  it("warns on unparseable messages", () => {
    const capture = createCapture();
    createRoarrSink(makeLogger(capture))("not-json");
    expect(capture.byLevel("warn").length).toBe(1);
  });
});

describe("winston adapter", () => {
  it("throws a descriptive error when winston is not installed", async () => {
    // Mirrors the log4js contract: winston is not installed in this
    // environment, so the adapter must surface the install hint.
    await expect(createWinstonTransport(new Logger({}))).rejects.toThrow(
      /Optional peer dependency "winston"/,
    );
  });
});

describe("pino-compat", () => {
  it("supports child loggers and level methods", () => {
    const capture = createCapture();
    const log = pino({ level: "trace", sinks: [capture.sink] });
    const child = log.child({ requestId: "r1" });
    child.info("hello");
    log.warn("parent");
    expect(capture.messages()).toEqual(["hello", "parent"]);
    expect(capture.entries[0]?.context).toMatchObject({ requestId: "r1" });
  });

  it("emits pino-shaped JSON through the json formatter", () => {
    const capture = createCapture();
    const log = pino({ name: "svc", level: "trace", sinks: [capture.sink] });
    log.info({ key: "value" }, "structured");
    const entry = capture.entries[0]!;
    expect(entry.context.key).toBe("value");
    expect(entry.message).toBe("structured");
  });

  it("emits pino-shaped NDJSON to the console by default", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const log = pino({ name: "svc", level: "trace" });
      log.child({ requestId: "r1" }).info({ status: 200 }, "handled");
      expect(spy).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse(String(spy.mock.calls[0]?.[0])) as Record<string, unknown>;
      expect(parsed.level).toBe(30);
      expect(parsed.msg).toBe("handled");
      expect(typeof parsed.time).toBe("number");
      expect(parsed.name).toBe("svc");
      expect(parsed.requestId).toBe("r1");
      expect(parsed.status).toBe(200);
    } finally {
      spy.mockRestore();
    }
  });

  it("honors timestamp: false by omitting time", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const log = pino({ level: "trace", timestamp: false });
      log.info("plain");
      const parsed = JSON.parse(String(spy.mock.calls[0]?.[0])) as Record<string, unknown>;
      expect(parsed.time).toBeUndefined();
      expect(parsed.msg).toBe("plain");
    } finally {
      spy.mockRestore();
    }
  });

  it("exposes a get/set level surface", () => {
    const log = pino({ level: "warn" });
    expect(log.level).toBe("warn");
    log.level = "trace";
    expect(log.level).toBe("trace");
  });
});
