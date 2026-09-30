# Architecture

loggerkit follows the same dependency discipline as the other `*kit` packages and is enforced by `test/architecture.test.ts`:

```
core.ts                    (leaf: levels, LogEntry, Sink, errors)
  ↑
sinks/*  formatters/*      (transports and rendering; import core only)
  ↑
logger.ts                  (Logger: level filter, context merge, fan-out)
  ↑
factory.ts  manager.ts     (composition: sink specs, registry)
  ↑
adapters/*  pino-compat.ts (integration layer; imports logger/core and leaf sinks)
```

Rules:

- `core.ts` imports nothing internal.
- Sinks and formatters may import `core.ts` only.
- Adapters may import `logger.ts`/`core.ts`, never composition modules.
- `index.ts` is the composition layer (core, sinks, formatters, factory, testing).
- Optional peer SDKs must never be imported statically — load them via `importOptionalPeer()`. The guard rejects any non-relative import that is not a `node:` builtin.
- No runtime dependencies are allowed; only optional peers.

Entry points mirror `package.json` `exports`; tsup emits ESM + CJS + dts for each.
