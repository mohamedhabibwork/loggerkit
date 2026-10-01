import { levelEnabled, type LogEntry, type LogLevel, type Processor } from "./core.js";

export interface RedactOptions {
  /** Turn redaction off (e.g. local debugging) without changing the pipeline. Defaults to true. */
  enabled?: boolean;
  /** Include `DEFAULT_REDACT_KEYS`. Defaults to true; set false to supply your own list only. */
  useDefaultKeys?: boolean;
  /** Extra key names censored at any depth, case-insensitive, added to the defaults. */
  keys?: readonly string[];
  /** Key names to never censor, even if listed in the defaults or `keys`. */
  excludeKeys?: readonly string[];
  /**
   * Dotted paths into `context` to censor, e.g. `"user.password"`.
   * `*` matches any single key: `"headers.*"`.
   */
  paths?: readonly string[];
  /**
   * Replacement value, or a function of the original value and key
   * (e.g. keep the last 4 characters). Defaults to `"[REDACTED]"`.
   * Ignored when `remove` is true.
   */
  censor?: unknown | ((value: unknown, key: string) => unknown);
  /** Delete matched keys instead of replacing them. Defaults to false. */
  remove?: boolean;
  /** Max object/array nesting searched for `keys`. Defaults to 12. */
  maxDepth?: number;
}

type Censor = (value: unknown, key: string) => unknown;

/** Secret-bearing key names `redact()` censors unless `useDefaultKeys: false`. */
export const DEFAULT_REDACT_KEYS: readonly string[] = [
  "password",
  "passwd",
  "secret",
  "token",
  "accessToken",
  "refreshToken",
  "apiKey",
  "api_key",
  "authorization",
  "cookie",
  "set-cookie",
  "creditCard",
  "cvv",
];

const DEFAULT_MAX_DEPTH = 12;
const DEFAULT_CENSOR = "[REDACTED]";

/**
 * Censors sensitive fields (objects and arrays) without mutating the
 * original context. It does not rewrite `message` or error text — keep
 * secrets out of message strings.
 */
export function redact(options: RedactOptions = {}): Processor {
  if (options.enabled === false) {
    return (entry) => entry;
  }
  const censorOption = options.censor ?? DEFAULT_CENSOR;
  const censor: Censor =
    typeof censorOption === "function" ? (censorOption as Censor) : () => censorOption;
  const settings: RedactSettings = {
    keys: resolveKeys(options),
    censor,
    remove: options.remove === true,
    maxDepth: Math.max(0, options.maxDepth ?? DEFAULT_MAX_DEPTH),
  };
  const paths = (options.paths ?? []).map((path) => path.split("."));

  return (entry) => {
    let context = settings.keys.size > 0 ? redactKeys(entry.context, settings, 0) : entry.context;
    for (const path of paths) {
      context = redactPath(context, path, settings);
    }
    return context === entry.context ? entry : { ...entry, context };
  };
}

interface RedactSettings {
  readonly keys: ReadonlySet<string>;
  readonly censor: Censor;
  readonly remove: boolean;
  readonly maxDepth: number;
}

function resolveKeys(options: RedactOptions): ReadonlySet<string> {
  const base = options.useDefaultKeys === false ? [] : DEFAULT_REDACT_KEYS;
  const excluded = new Set((options.excludeKeys ?? []).map((key) => key.toLowerCase()));
  return new Set(
    [...base, ...(options.keys ?? [])]
      .map((key) => key.toLowerCase())
      .filter((key) => !excluded.has(key)),
  );
}

function redactKeys(
  value: Readonly<Record<string, unknown>>,
  settings: RedactSettings,
  depth: number,
): Readonly<Record<string, unknown>> {
  if (depth > settings.maxDepth) {
    return value;
  }
  let changed = false;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (settings.keys.has(key.toLowerCase())) {
      changed = true;
      if (!settings.remove) {
        output[key] = settings.censor(child, key);
      }
      continue;
    }
    const next = redactValue(child, settings, depth + 1);
    changed ||= next !== child;
    output[key] = next;
  }
  return changed ? output : value;
}

function redactValue(value: unknown, settings: RedactSettings, depth: number): unknown {
  if (Array.isArray(value)) {
    if (depth > settings.maxDepth) {
      return value;
    }
    const mapped = value.map((item) => redactValue(item, settings, depth + 1));
    return mapped.some((item, index) => item !== value[index]) ? mapped : value;
  }
  return isPlainObject(value) ? redactKeys(value, settings, depth) : value;
}

function redactPath(
  value: Readonly<Record<string, unknown>>,
  path: readonly string[],
  settings: RedactSettings,
): Readonly<Record<string, unknown>> {
  const [head, ...rest] = path;
  if (head === undefined) {
    return value;
  }
  const targets = head === "*" ? Object.keys(value) : head in value ? [head] : [];
  if (targets.length === 0) {
    return value;
  }
  const output: Record<string, unknown> = { ...value };
  for (const key of targets) {
    if (rest.length === 0) {
      if (settings.remove) {
        delete output[key];
      } else {
        output[key] = settings.censor(value[key], key);
      }
      continue;
    }
    const child = value[key];
    if (isPlainObject(child)) {
      output[key] = redactPath(child, rest, settings);
    }
  }
  return output;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

export interface SampleOptions {
  /** Turn sampling off (keep everything). Defaults to true. */
  enabled?: boolean;
  /** Keep ratio per level in [0, 1]; levels not listed are always kept. */
  rates: Partial<Record<LogLevel, number>>;
  /** Random source in [0, 1); injectable for tests. */
  random?: () => number;
}

/** Probabilistic sampling, typically for high-volume `debug`/`info` traffic. */
export function sample(options: SampleOptions): Processor {
  if (options.enabled === false) {
    return (entry) => entry;
  }
  const random = options.random ?? Math.random;
  return (entry) => {
    const rate = options.rates[entry.level];
    if (rate === undefined || rate >= 1) {
      return entry;
    }
    return random() < rate ? entry : null;
  };
}

export interface RateLimitOptions {
  /** Turn rate limiting off. Defaults to true. */
  enabled?: boolean;
  /** Max entries per window per key. */
  limit: number;
  /** Window length in ms; defaults to 1000. */
  windowMs?: number;
  /** Groups entries; defaults to level + message so one noisy line cannot drown others. */
  key?: (entry: LogEntry) => string;
  /** Levels at or above this are never limited; defaults to `error`. */
  exemptFrom?: LogLevel;
  /** Clock; injectable for tests. */
  now?: () => number;
}

/** Drops entries beyond `limit` per key per window. */
export function rateLimit(options: RateLimitOptions): Processor {
  if (options.enabled === false) {
    return (entry) => entry;
  }
  const windowMs = options.windowMs ?? 1000;
  const keyOf = options.key ?? ((entry: LogEntry) => `${entry.level}:${entry.message}`);
  const exemptFrom = options.exemptFrom ?? "error";
  const now = options.now ?? Date.now;
  let windowStart = now();
  let counts = new Map<string, number>();

  return (entry) => {
    if (levelEnabled(entry.level, exemptFrom)) {
      return entry;
    }
    const current = now();
    if (current - windowStart >= windowMs) {
      windowStart = current;
      counts = new Map();
    }
    const key = keyOf(entry);
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    return count <= options.limit ? entry : null;
  };
}

/** Adds static fields, or fields computed per entry, under existing context. */
export function enrich(
  fields: Record<string, unknown> | ((entry: LogEntry) => Record<string, unknown>),
): Processor {
  return (entry) => {
    const extra = typeof fields === "function" ? fields(entry) : fields;
    return { ...entry, context: { ...extra, ...entry.context } };
  };
}

/** Drops entries below `level`. */
export function minLevel(level: LogLevel): Processor {
  return (entry) => (levelEnabled(entry.level, level) ? entry : null);
}
