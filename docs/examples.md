# Examples

Practical code recipes for `@mohamedhabibwork/loggerkit` — beyond the README quick start.

---

## Table of contents

- [Console + JSON formatter](#console--json-formatter)
- [File rotation by size](#file-rotation-by-size)
- [Child logger with request context](#child-logger-with-request-context)
- [HTTP sink to Elasticsearch](#http-sink-to-elasticsearch)
- [Loki sink with labels](#loki-sink-with-labels)
- [Datadog logs sink](#datadog-logs-sink)
- [OTLP / OpenTelemetry sink](#otlp--opentelemetry-sink)
- [Syslog sink (RFC 5424)](#syslog-sink-rfc-5424)
- [GELF sink (Graylog)](#gelf-sink-graylog)
- [Splunk HEC sink](#splunk-hec-sink)
- [Logstash sink](#logstash-sink)
- [pino-compatible API](#pino-compatible-api)
- [Express adapter (middleware)](#express-adapter-middleware)
- [Hono adapter](#hono-adapter)
- [Fastify adapter](#fastify-adapter)
- [Winston adapter](#winston-adapter)
- [Memory sink for testing](#memory-sink-for-testing)
- [Multi-sink with filtering](#multi-sink-with-filtering)
- [Graceful shutdown](#graceful-shutdown)

---

## Console + JSON formatter

```ts
import { createLogger } from "@mohamedhabibwork/loggerkit";

const logger = createLogger({
  name: "app",
  level: "info",
  sinks: [
    {
      kind: "console",
      formatter: "json",
    },
  ],
});

logger.info("server started", { port: 3000 });
// {"level":"info","name":"app","msg":"server started","port":3000,"time":"2025-10-01T..."}
```

## File rotation by size

```ts
import { createLogger } from "@mohamedhabibwork/loggerkit";

const logger = createLogger({
  name: "app",
  level: "debug",
  sinks: [
    {
      kind: "file",
      path: "./logs/app.log",
      formatter: "json",
      maxBytes: 10 * 1024 * 1024, // 10 MB per file
      maxFiles: 5, // keep 5 rotated files
    },
  ],
});
```

## Child logger with request context

```ts
import { createLogger } from "@mohamedhabibwork/loggerkit";

const logger = createLogger({
  name: "api",
  level: "info",
  sinks: [{ kind: "console" }],
});

const requestLogger = logger.child({ requestId: "req-abc-123", userId: 42 });

requestLogger.info("processing order");
// inherits requestId + userId on every log line
requestLogger.error("payment failed", new Error("card declined"));
```

## HTTP sink to Elasticsearch

```ts
import { createLogger } from "@mohamedhabibwork/loggerkit";

const logger = createLogger({
  name: "app",
  level: "info",
  sinks: [
    {
      kind: "http",
      url: "http://localhost:9200/app-logs/_doc",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      formatter: "json",
      batchSize: 100,
      flushInterval: 5000,
    },
  ],
});
```

## Loki sink with labels

```ts
import { createLogger } from "@mohamedhabibwork/loggerkit";

const logger = createLogger({
  name: "app",
  level: "info",
  sinks: [
    {
      kind: "loki",
      url: "http://localhost:3100/loki/api/v1/push",
      labels: { service: "api", env: "production" },
      batchSize: 50,
      flushInterval: 2000,
    },
  ],
});
```

## Datadog logs sink

```ts
import { createLogger } from "@mohamedhabibwork/loggerkit";

const logger = createLogger({
  name: "app",
  level: "info",
  sinks: [
    {
      kind: "datadog",
      apiKey: process.env.DATADOG_API_KEY!,
      service: "my-api",
      source: "nodejs",
      batchSize: 100,
      flushInterval: 5000,
    },
  ],
});
```

## OTLP / OpenTelemetry sink

```ts
import { createLogger } from "@mohamedhabibwork/loggerkit";

const logger = createLogger({
  name: "app",
  level: "info",
  sinks: [
    {
      kind: "otlp",
      endpoint: "http://localhost:4318/v1/logs",
      serviceName: "my-api",
      headers: {},
    },
  ],
});
```

## Syslog sink (RFC 5424)

```ts
import { createLogger } from "@mohamedhabibwork/loggerkit";

const logger = createLogger({
  name: "app",
  level: "info",
  sinks: [
    {
      kind: "syslog",
      host: "localhost",
      port: 514,
      protocol: "udp",
      facility: "local0",
      appName: "my-api",
    },
  ],
});
```

## GELF sink (Graylog)

```ts
import { createLogger } from "@mohamedhabibwork/loggerkit";

const logger = createLogger({
  name: "app",
  level: "info",
  sinks: [
    {
      kind: "gelf",
      host: "localhost",
      port: 12201,
      protocol: "udp",
      facility: "my-api",
    },
  ],
});
```

## Splunk HEC sink

```ts
import { createLogger } from "@mohamedhabibwork/loggerkit";

const logger = createLogger({
  name: "app",
  level: "info",
  sinks: [
    {
      kind: "splunk",
      url: "https://localhost:8088/services/collector/event",
      token: process.env.SPLUNK_HEC_TOKEN!,
      source: "nodejs",
      sourcetype: "_json",
      batchSize: 100,
      flushInterval: 5000,
    },
  ],
});
```

## Logstash sink

```ts
import { createLogger } from "@mohamedhabibwork/loggerkit";

const logger = createLogger({
  name: "app",
  level: "info",
  sinks: [
    {
      kind: "logstash",
      host: "localhost",
      port: 5000,
      protocol: "tcp",
      formatter: "json",
    },
  ],
});
```

## pino-compatible API

```ts
import { createPinoCompatibleLogger } from "@mohamedhabibwork/loggerkit/pino-compat";

const log = createPinoCompatibleLogger({
  name: "app",
  level: "info",
  transport: { target: "pino-pretty" },
});

log.info({ userId: 42 }, "user logged in");
log.child({ requestId: "req-123" }).info("processing");
```

## Express adapter (middleware)

```ts
import express from "express";
import { createLogger } from "@mohamedhabibwork/loggerkit";
import { expressLogger } from "@mohamedhabibwork/loggerkit/adapters/express";

const logger = createLogger({
  name: "api",
  level: "info",
  sinks: [{ kind: "console" }],
});

const app = express();
app.use(
  expressLogger(logger, {
    skip: (req) => req.url === "/health",
  }),
);
```

## Hono adapter

```ts
import { Hono } from "hono";
import { createLogger } from "@mohamedhabibwork/loggerkit";
import { honoLogger } from "@mohamedhabibwork/loggerkit/adapters/hono";

const logger = createLogger({
  name: "api",
  level: "info",
  sinks: [{ kind: "console" }],
});

const app = new Hono();
app.use(honoLogger(logger));
```

## Fastify adapter

```ts
import Fastify from "fastify";
import { createLogger } from "@mohamedhabibwork/loggerkit";
import { fastifyLogger } from "@mohamedhabibwork/loggerkit/adapters/fastify";

const logger = createLogger({
  name: "api",
  level: "info",
  sinks: [{ kind: "console" }],
});

const app = Fastify({ logger: false });
app.register(fastifyLogger(logger));
```

## Winston adapter

```ts
import { createLogger } from "@mohamedhabibwork/loggerkit";
import { fromWinston } from "@mohamedhabibwork/loggerkit/adapters/winston";

const winston = fromWinston({
  level: "info",
  format: winston.format.json(),
  transports: [new winston.transports.Console()],
});

// winston is a loggerkit Logger — use it with any manager
const logger = createLogger({
  name: "app",
  level: "info",
  sinks: [winston],
});
```

## Memory sink for testing

```ts
import { createLogger } from "@mohamedhabibwork/loggerkit";
import { createMemorySink } from "@mohamedhabibwork/loggerkit/sinks/memory";

const sink = createMemorySink();
const logger = createLogger({
  name: "test",
  level: "debug",
  sinks: [sink],
});

logger.info("test message");

const entries = sink.entries();
expect(entries).toHaveLength(1);
expect(entries[0].message).toBe("test message");
```

## Multi-sink with filtering

```ts
import { createLogger } from "@mohamedhabibwork/loggerkit";

const logger = createLogger({
  name: "app",
  level: "debug",
  sinks: [
    // console: only warn and above
    {
      kind: "console",
      level: "warn",
      formatter: "pretty",
    },
    // file: everything
    {
      kind: "file",
      path: "./logs/app.log",
      formatter: "json",
    },
    // http: only errors
    {
      kind: "http",
      url: "http://localhost:9200/errors/_doc",
      method: "POST",
      level: "error",
      formatter: "json",
    },
  ],
});
```

## Graceful shutdown

```ts
import { createLogger } from "@mohamedhabibwork/loggerkit";

const logger = createLogger({
  name: "app",
  level: "info",
  sinks: [
    { kind: "console" },
    { kind: "file", path: "./logs/app.log", formatter: "json" },
    { kind: "loki", url: "http://localhost:3100/loki/api/v1/push", labels: { service: "api" } },
  ],
});

// ... use logger ...

process.on("SIGTERM", async () => {
  await logger.close(); // flushes all buffers, closes all sinks
  process.exit(0);
});
```
