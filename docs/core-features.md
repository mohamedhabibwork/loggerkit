# Core features

## Processors

A processor runs on every entry before sinks: return a new entry to keep it, `null` to drop it. They must not mutate their input.

| Processor              | Purpose                                                                                                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `redact(options?)`     | Censor secrets by key name (any depth, case-insensitive) or dotted path (`*` wildcard). Uses `DEFAULT_REDACT_KEYS` unless configured otherwise — see below. |
| `sample({ rates })`    | Keep a fraction of entries per level, e.g. `{ debug: 0.1 }`                                                                                                 |
| `rateLimit({ limit })` | Max entries per key per window (default key: level + message); `error`+ exempt                                                                              |
| `enrich(fields \| fn)` | Add static or computed fields under call-site fields                                                                                                        |
| `minLevel(level)`      | Drop entries below a level                                                                                                                                  |

### Redaction options

Every option is optional; `redact()` alone censors `DEFAULT_REDACT_KEYS` (passwords, tokens, cookies, API keys, card data).

| Option           | Default        | Meaning                                                                           |
| ---------------- | -------------- | --------------------------------------------------------------------------------- |
| `enabled`        | `true`         | `false` disables redaction, e.g. `enabled: process.env.NODE_ENV === "production"` |
| `useDefaultKeys` | `true`         | `false` to use only your own `keys`                                               |
| `keys`           | `[]`           | Extra key names, added to the defaults                                            |
| `excludeKeys`    | `[]`           | Keys to never censor (e.g. `["token"]` while debugging auth)                      |
| `paths`          | `[]`           | Dotted paths, `*` wildcard: `"req.headers.*"`                                     |
| `censor`         | `"[REDACTED]"` | Replacement value, or `(value, key) => masked`                                    |
| `remove`         | `false`        | Delete matched keys instead of replacing                                          |
| `maxDepth`       | `12`           | Nesting searched for `keys`                                                       |

```ts
redact(); // defaults
redact({ keys: ["ssn", "iban"], excludeKeys: ["cookie"] }); // extend and trim
redact({ useDefaultKeys: false, keys: ["pin"] }); // fully custom
redact({ censor: (value) => `****${String(value).slice(-4)}` }); // partial mask
redact({ enabled: process.env.LOG_REDACT !== "off" }); // toggle while debugging
```

`sample` and `rateLimit` also accept `enabled: false`.

A processor that throws drops the entry and reports through `onError(error, "processor")`.

## Async context

```ts
import { createLogContext } from "@mohamedhabibwork/loggerkit/context";

const context = createLogContext();
const logger = createLogger({ contextProvider: context.provider });

app.use((req, res, next) => context.run({ requestId: req.id }, next));
context.assign({ userId }); // later, inside the same request
```

Precedence: logger bindings < async context < call-site fields. Children inherit the provider.

## Timers and level checks

```ts
const done = logger.time("render", "info");
const ms = done({ template: "home" }); // logs { template, durationMs }

if (logger.isLevelEnabled("debug")) {
  logger.debug("state", expensiveSnapshot());
}
```

## KitLogger

`KitLogger` (`debug/info/warn/error`) is the contract the other @mohamedhabibwork kits accept. Any loggerkit `Logger` or child satisfies it.
