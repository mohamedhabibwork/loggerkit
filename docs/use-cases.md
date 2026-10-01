# Use cases

One example per common use case for `@mohamedhabibwork/loggerkit`.

---

## Structured API logging

```ts
import { createLogger } from "@mohamedhabibwork/loggerkit";

const logger = createLogger({
  name: "api",
  level: "info",
  sinks: [{ kind: "console", formatter: "json" }],
});

logger.info("order created", { orderId: "ord-123", userId: 42, total: 99.99 });
logger.warn("rate limit approaching", { userId: 42, remaining: 5 });
```

## Request-scoped child loggers

```ts
const logger = createLogger({ name: "api", sinks: [{ kind: "console" }] });

app.use((req, res, next) => {
  const requestLogger = logger.child({ requestId: crypto.randomUUID() });
  req.logger = requestLogger;
  requestLogger.info("request started", { method: req.method, url: req.url });
  next();
});

app.get("/orders/:id", (req, res) => {
  req.logger.info("fetching order", { orderId: req.params.id });
});
```

## Multi-environment configuration

```ts
const isProd = process.env.NODE_ENV === "production";

const logger = createLogger({
  name: "app",
  level: isProd ? "info" : "debug",
  sinks: isProd
    ? [
        { kind: "console", formatter: "json" },
        { kind: "loki", url: process.env.LOKI_URL!, labels: { env: "prod" } },
      ]
    : [{ kind: "console", formatter: "pretty" }],
});
```

## Error tracking with context

```ts
try {
  await processPayment(orderId);
} catch (err) {
  logger.error("payment processing failed", err, { orderId, userId, amount });
}
```

## Centralized logging with Elasticsearch

```ts
const logger = createLogger({
  name: "api",
  level: "info",
  sinks: [
    {
      kind: "elasticsearch",
      node: "http://localhost:9200",
      index: "app-logs",
      batchSize: 100,
      flushInterval: 5000,
    },
  ],
});
```

## Metrics and tracing with OTLP

```ts
const logger = createLogger({
  name: "api",
  level: "info",
  sinks: [
    {
      kind: "otlp",
      endpoint: "http://localhost:4318/v1/logs",
      serviceName: "api",
    },
  ],
});
```

## Audit logging

```ts
const auditLogger = createLogger({
  name: "audit",
  level: "info",
  sinks: [{ kind: "file", path: "./logs/audit.log", formatter: "json" }],
});

auditLogger.info("user login", { userId: 42, ip: "192.168.1.1" });
auditLogger.info("permission granted", { userId: 42, resource: "orders", action: "read" });
```

## Debug mode in development

```ts
const logger = createLogger({
  name: "app",
  level: process.env.DEBUG ? "debug" : "info",
  sinks: [{ kind: "console", formatter: "pretty" }],
});

logger.debug("cache miss", { key: "user:42" });
logger.debug("db query", { sql: "SELECT * FROM orders WHERE id = ?", params: [123] });
```

## Log redaction for sensitive fields

```ts
const logger = createLogger({
  name: "api",
  level: "info",
  sinks: [
    {
      kind: "console",
      formatter: "json",
      redact: ["password", "token", "ssn", "*.secret"],
    },
  ],
});

logger.info("user data", { userId: 42, password: "hunter2", token: "abc-123" });
// {"userId":42,"password":"[REDACTED]","token":"[REDACTED]"}
```
