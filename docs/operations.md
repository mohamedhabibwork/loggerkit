# Operations

## Scripts

- `npm run check` — format:check + lint + typecheck + test + build (the full gate)
- `npm run build` — tsup, ESM + CJS + dts per exports entry
- `npm run publish:if-needed` — idempotent publish used by CI (skips when the version is already on npm)
- `npm run verify:exports` — checks every `exports` target exists in the built `dist/` and loads the root entrypoint from ESM and CJS (run after `npm run build`)

## Runtime matrix

Node >= 20 (built-in `fetch` is required by the HTTP sink). CI runs the full gate on Node 20/22/24/26 plus a Bun/Deno runtime smoke against the built `dist/` (`scripts/runtime-smoke.mjs`, runnable with `bun` or `deno run --allow-read` after a build).

## Rotation

`FileSink` rotates by size before the write that would exceed `maxBytes`, shifting `app.log.1` … `app.log.N` (`maxFiles`, default 5). Rotation happens inside the sink's serialized write chain, so no interleaving occurs.

## HTTP delivery

`HttpSink` batches rendered lines (`batchSize`, default 1), posts them as a JSON array (single line stays a plain body), aborts on `timeoutMs` (default 5000), and swallows delivery failures after a `console.warn` — a down telemetry backend must not take the app down. `close()` flushes the queue.

## Versioning

Independent semver per package in the kits workspace. `CHANGELOG.md` is seeded manually for the initial release and updated by `release-notes.yml` on every `v*` tag.

## Release flow

1. Bump `package.json` and update `CHANGELOG.md` if needed.
2. Run `npm run check` until green.
3. Commit, then push a `vX.Y.Z` tag.
4. `publish.yml` re-runs the gate and publishes idempotently with provenance; `release-notes.yml` creates the GitHub release and writes the changelog entry back to `main`.
