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

Level mapping:

- winston `silly`/`verbose` → `trace`, `http` → `info`; unknown levels → `info`
- bunyan numeric levels (10..60) map to the six loggerkit levels
- log4js unknown `levelStr` → `info`
- roarr numeric levels map in 10-point bands to the six loggerkit levels
