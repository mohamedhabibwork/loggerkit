# AGENTS.md

Guidance for AI coding agents (and humans) working in this repository.

## What this is

**loggerkit** (`@mohamedhabibwork/loggerkit`) — provider-first, runtime-portable TypeScript
logging: a small core (levels, structured entries, sinks, formatters), pluggable transports,
a pino-compatible facade, and adapters for hono, elysia, winston, loglevel, bunyan, log4js,
morgan, and roarr. Zero runtime dependencies. Node >= 20, Bun, Deno; dual ESM/CJS.

## Layout

- `src/` — flat modules; the dependency direction is whitelisted (see below). `core.ts` is the
  leaf (levels, `LogEntry`, `Sink`, `Formatter`, errors); `sinks/*` and `formatters/*` import core
  only; `logger.ts` fans out to sinks; `factory.ts`/`manager.ts` compose; `adapters/*` and
  `pino-compat.ts` sit on top; `index.ts` is the composition layer for the root entrypoint.
- `src/sinks/file.ts` — zero-dependency size-based rotation (serialized write chain).
- `test/` — Vitest suites, including `architecture.test.ts` (boundary guard) and
  `peer-dependencies.test.ts` (optional-peer contract).
- `docs/` — markdown guides. README, `llms.txt`, and `docs/` ship in the npm tarball.

## Commands

```sh
npm ci             # install exactly the lockfile (dev deps only)
npm run check      # format:check -> lint -> typecheck -> test -> build  (the gate)
npm run lint:fix   # oxlint --fix
npm run format     # oxfmt (also formats markdown and llms.txt)
npm test           # vitest run
npm run verify:exports  # after a build: every exports target resolves from dist
```

CI fails on any lint warning (`--deny-warnings`), any formatting diff, or any architecture
violation. Run `npm run check` before declaring anything done.

## Conventions

- **Formatting is oxfmt, not opinion**: never hand-format; run `npm run format`. Markdown and
  `llms.txt` are formatted too.
- **Lint**: `.oxlintrc.json` enables correctness/suspicious/perf across typescript, unicorn,
  import, promise plugins. If a rule fires on intentional code, add an inline
  `// oxlint-disable-next-line <rule>` with a reason — never widen the config for one site.
- **Architecture**: `test/architecture.test.ts` whitelists which modules each module may import,
  and rejects any non-relative import that is not a `node:` builtin — optional peer SDKs must
  never be imported statically. Adding a module REQUIRES registering it there and describing it
  in `docs/architecture.md`.
- **Dependencies**: no runtime dependencies. Optional peers are loaded via `importOptionalPeer()`
  with an install-hinting error; only `winston` and `log4js` (auto-registration path) load a
  peer SDK — the other adapters bind to instances or structural values you pass in.
- **TypeScript**: `strict`, NodeNext, `verbatimModuleSyntax`; keep `import type` discipline.
- **Docs**: API changes update README, `llms.txt`, and the matching `docs/*.md` together.

## Gotchas

- pino-compat takes the merging object first — `log.info({ status: 200 }, "handled")` — and
  writes NDJSON to the console unless you pass `sinks`.
- File sink rotation happens inside the serialized write chain; writes never interleave.
- The HTTP sink never throws on delivery failures (warns via `console.warn`); `close()` flushes.
- The console sink emits its own NDJSON payload (`time`, `level`, `message`, ...) unless you pass
  a `formatter`; file and HTTP sinks default to `jsonFormatter()`.
- `Logger.child("", bindings)` keeps the parent name (used by the pino facade).
