# Adapters

All adapters are separate subpaths with optional peer dependencies. Only `winston` (always) and `log4js` (when you pass `{ name }` for auto-registration) load their SDK lazily via `importOptionalPeer()` and must be installed; the other adapters bind to instances or structural values you pass in and import nothing.

| Adapter  | SDK loading                | Usage                                                                                          |
| -------- | -------------------------- | ---------------------------------------------------------------------------------------------- |
| hono     | none (structural)          | `app.use(requestLogger(logger))`                                                               |
| elysia   | none (structural)          | `new Elysia().use(elysiaLogger(logger))`                                                       |
| winston  | lazy, required             | `winston.add(await createWinstonTransport(logger))`                                            |
| loglevel | none (structural)          | `Object.assign(log, createLoglevelMethods(logger))`                                            |
| bunyan   | none (structural)          | add `{ level: "trace", type: "raw", stream: createBunyanStream(logger) }` to `streams`         |
| log4js   | lazy, only with `{ name }` | `await createLog4jsAppender(logger, { name: "loggerkit" })` registers via `log4js.addAppender` |
| morgan   | none (structural)          | `morgan("combined", { stream: createMorganStream(logger) })`                                   |
| roarr    | none (structural)          | `ROARR.write = createRoarrSink(logger)`                                                        |
| pino     | none (structural)          | `pino({ level: "trace" }, createPinoDestination(logger))`                                      |
| consola  | none (structural)          | `consola.setReporters([createConsolaReporter(logger)])`                                        |
| debug    | none (structural)          | `createDebug.log = createDebugLog(logger)`                                                     |
| express  | none (structural)          | `app.use(expressLogger(logger))`; use `req.log` in handlers                                    |
| fastify  | none (structural)          | `Fastify({ loggerInstance: toFastifyLogger(logger) })` (v5) or `{ logger: ... }` (v4)          |
| nestjs   | none (structural)          | `app.useLogger(new NestLoggerService(logger))`                                                 |
| console  | none                       | `const restore = captureConsole(logger)` — don't combine with a console sink on that logger    |

Level mapping:

- winston `silly`/`verbose` → `trace`, `http` → `info`; unknown levels → `info`
- bunyan numeric levels (10..60) map to the six loggerkit levels
- log4js unknown `levelStr` → `info`
- roarr numeric levels map in 10-point bands to the six loggerkit levels
- pino numeric levels (10..60) map to the six loggerkit levels; `err` becomes the entry error
- consola: `0` → error (`fatal` type → fatal), `1` → warn, `2`/`3` → info, `4` → debug, `5+` → trace
- NestJS: `log` → info, `verbose` → trace; the trailing string argument becomes `context`
- express: status ≥ 500 → error, ≥ 400 or aborted → warn, otherwise info
