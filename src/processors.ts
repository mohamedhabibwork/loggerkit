import { levelEnabled, type LogEntry, type LogLevel, type Processor } from "./core.js";

export interface RedactOptions {
  /**
   * Dotted paths into `context` to censor, e.g. `"user.password"`.
   * `*` matches any single key: `"headers.*"`.
   */
  paths?: string[];
  /** Key names censored at any depth, case-insensitive (e.g. `"authorization"`). */
  keys?: readonly string[];
  /** Replacement value; defaults to `"[REDACTED]"`. Ignored when `remove` is true. */
  censor?: unknown;
  /** Delete matched keys instead of replacing them. */
  remove?: boolean;
}

/** Common secret-bearing key names, usable as `redact({ keys: DEFAULT_REDACT_KEYS })`. */
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

const MAX_REDACT_DEPTH = 12;

/**
 * Censors sensitive fields (objects and arrays) without mutating the
 * original context. It does not rewrite `message` or error text — keep
 * secrets out of message strings.
 */
export function redact(options: RedactOptions): Processor {
  const censor = options.censor ?? "[REDACTED]";
  const remove = options.remove === true;
  const keys = new Set((options.keys ?? []).map((key) => key.toLowerCase()));
  const paths = (options.paths ?? []).map((path) => path.split("."));

  return (entry) => {
    let context =
      keys.size > 0 ? redactKeys(entry.context, keys, censor, remove, 0) : entry.context;
    for (const path of paths) {
      context = redactPath(context, path, censor, remove);
    }
    return context === entry.context ? entry : { ...entry, context };
  };
}

function redactKeys(
  value: Readonly<Record<string, unknown>>,
  keys: ReadonlySet<string>,
  censor: unknown,
  remove: boolean,
  depth: number,
): Readonly<Record<string, unknown>> {
  if (depth > MAX_REDACT_DEPTH) {
    return value;
  }
  let changed = false;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (keys.has(key.toLowerCase())) {
      changed = true;
      if (!remove) {
        output[key] = censor;
      }
      continue;
    }
    const next = redactValue(child, keys, censor, remove, depth + 1);
    changed ||= next !== child;
    output[key] = next;
  }
  return changed ? output : value;
}

function redactValue(
  value: unknown,
  keys: ReadonlySet<string>,
  censor: unknown,
  remove: boolean,
  depth: number,
): unknown {
  if (Array.isArray(value)) {
    const mapped = value.map((item) => redactValue(item, keys, censor, remove, depth + 1));
    return mapped.some((item, index) => item !== value[index]) ? mapped : value;
  }
  return isPlainObject(value) ? redactKeys(value, keys, censor, remove, depth) : value;
}

function redactPath(
  value: Readonly<Record<string, unknown>>,
  path: readonly string[],
  censor: unknown,
  remove: boolean,
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
      if (remove) {
        delete output[key];
      } else {
        output[key] = censor;
      }
      continue;
    }
    const child = value[key];
    if (isPlainObject(child)) {
      output[key] = redactPath(child, rest, censor, remove);
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
  /** Keep ratio per level in [0, 1]; levels not listed are always kept. */
  rates: Partial<Record<LogLevel, number>>;
  /** Random source in [0, 1); injectable for tests. */
  random?: () => number;
}

/** Probabilistic sampling, typically for high-volume `debug`/`info` traffic. */
export function sample(options: SampleOptions): Processor {
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
