# loggerkit

> Provider-first, runtime-portable TypeScript logging: sinks, formatters, and framework adapters.

[![npm version](https://img.shields.io/npm/v/@mohamedhabibwork/loggerkit)](https://www.npmjs.com/package/@mohamedhabibwork/loggerkit)
[![npm downloads](https://img.shields.io/npm/dm/@mohamedhabibwork/loggerkit)](https://www.npmjs.com/package/@mohamedhabibwork/loggerkit)
[![CI](https://github.com/mohamedhabibwork/loggerkit/actions/workflows/ci.yml/badge.svg)](https://github.com/mohamedhabibwork/loggerkit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](./package.json)

`@mohamedhabibwork/loggerkit` is a zero-runtime-dependency logging kit: a small core (levels, structured entries, sinks, formatters), pluggable transports, a pino-compatible facade, and adapters for hono, elysia, winston, loglevel, bunyan, log4js, morgan, and roarr.

## Install

```bash
npm install @mohamedhabibwork/loggerkit
```

## Quick start

```ts
import { createLogger } from "@mohamedhabibwork/loggerkit/factory";

const logger = createLogger({
  name: "app",
  level: "info",
  sinks: [{ kind: "console" }, { kind: "file", filePath: "./logs/app.log", maxBytes: 10_000_000 }],
});

logger.info("service started", { port: 3000 });
logger.child("db").warn("slow query", { durationMs: 812 });
```

## Sinks

| Sink    | Import path                                       | Notes                                                                    |
| ------- | ------------------------------------------------- | ------------------------------------------------------------------------ |
| Console | `@mohamedhabibwork/loggerkit` / `./sinks/console` | Built-in console routing, NDJSON default                                 |
| Memory  | `./sinks/memory`                                  | Bounded in-memory buffer; used by `./testing`                            |
| File    | `./sinks/file`                                    | NDJSON append with size-based rotation, zero deps                        |
| HTTP    | `./sinks/http`                                    | Generic JSON webhook via global `fetch`, batching, timeout, never throws |
| Custom  | any object with `write(entry)`                    | Implements the core `Sink` interface                                     |

## Formatters

- `jsonFormatter()` — one JSON object per line (default)
- `prettyFormatter()` — human-readable single line with context fields

## Adapters

| Adapter  | Import path           | Direction                                      |
| -------- | --------------------- | ---------------------------------------------- |
| hono     | `./adapters/hono`     | Request-logging middleware + `c.set("logger")` |
| elysia   | `./adapters/elysia`   | Plugin with `derive` + `onRequest`             |
| winston  | `./adapters/winston`  | loggerkit as a winston transport               |
| loglevel | `./adapters/loglevel` | Method mapping for loglevel instances          |
| bunyan   | `./adapters/bunyan`   | Raw stream for bunyan `streams`                |
| log4js   | `./adapters/log4js`   | Appender function, optional auto-registration  |
| morgan   | `./adapters/morgan`   | `{ stream }` for morgan options                |
| roarr    | `./adapters/roarr`    | `ROARR.write` sink                             |

Adapter SDKs are **optional peers**. `winston` (and `log4js`, for name-based auto-registration) is loaded lazily and must be installed when used; the other adapters bind to instances or structural values you pass in and never import the SDK themselves.

## Pino-style API

```ts
import { pino } from "@mohamedhabibwork/loggerkit/pino-compat";

const log = pino({ name: "api" });
log.child({ requestId: "r1" }).info({ status: 200 }, "handled");
```

Writes NDJSON to the console by default (like pino); pass `sinks` to send entries elsewhere.

## Documentation

- [Architecture](./docs/architecture.md)
- [Custom sinks](./docs/custom-sinks.md)
- [Adapters](./docs/adapters.md)
- [Operations](./docs/operations.md)
- [Security](./docs/security.md)

## License

MIT © 2026 Mohamed Habib — see [LICENSE](./LICENSE).
