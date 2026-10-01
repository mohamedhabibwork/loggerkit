/**
 * Core contracts for loggerkit.
 *
 * This module is the dependency leaf: it must not import any other
 * loggerkit module. Sinks, formatters, loggers, adapters, and the
 * composition layer all build on top of it.
 */

export const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_WEIGHT: Readonly<Record<LogLevel, number>> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

export function levelWeight(level: LogLevel): number {
  return LEVEL_WEIGHT[level];
}

/** Returns true when `level` is at or above `threshold`. */
export function levelEnabled(level: LogLevel, threshold: LogLevel): boolean {
  return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[threshold];
}

export function parseLevel(value: string | undefined | null): LogLevel {
  if (value !== null && value !== undefined) {
    const normalized = value.trim().toLowerCase();
    if ((LOG_LEVELS as readonly string[]).includes(normalized)) {
      return normalized as LogLevel;
    }
  }
  throw new InvalidLevelError(value);
}

/** A structured log event, already level-filtered, ready for sinks. */
export interface LogEntry {
  /** Monotonic sequence number assigned by the logger. */
  readonly seq: number;
  readonly time: Date;
  readonly level: LogLevel;
  readonly message: string;
  /** Structured context merged from logger bindings and call-site fields. */
  readonly context: Readonly<Record<string, unknown>>;
  /** Logger name, if the logger was created with one. */
  readonly name?: string;
  /** Error attached to the entry, if any. */
  readonly error?: Error;
}

/**
 * A sink receives formatted-or-raw entries and persists them.
 * `flush` must be idempotent; `close` must be safe to call once.
 */
export interface Sink {
  readonly name: string;
  write(entry: LogEntry): void | Promise<void>;
  flush?(): void | Promise<void>;
  close?(): void | Promise<void>;
}

/**
 * Transforms an entry before it reaches sinks. Return a (new) entry to
 * keep it, or `null`/`undefined` to drop it. Processors must not mutate
 * their input.
 */
export type Processor = (entry: LogEntry) => LogEntry | null | undefined;

/** Supplies ambient fields (e.g. request id from async context) per entry. */
export type ContextProvider = () => Readonly<Record<string, unknown>> | undefined;

/**
 * Minimal structural logger contract shared by the @mohamedhabibwork kits
 * (cachekit, queuekit, notifykit, storagekit). A loggerkit `Logger`
 * satisfies it; so do pino, winston and console-shaped objects.
 */
export interface KitLogger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, errorOrFields?: Error | Record<string, unknown>): void;
}

/** Renders a LogEntry into a string (or any serializable value) for a sink. */
export type Formatter = (entry: LogEntry) => string;

/** Context keys that formatters treat as entry metadata rather than fields. */
export const RESERVED_KEYS: ReadonlySet<string> = new Set([
  "seq",
  "time",
  "level",
  "message",
  "name",
  "error",
]);

/** Context fields minus reserved keys, ready to merge into a payload. */
export function contextFields(entry: LogEntry): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entry.context)) {
    if (!RESERVED_KEYS.has(key)) {
      output[key] = value;
    }
  }
  return output;
}

/** JSON-safe error shape with recursive `cause`. */
export function serializeError(error: Error): Record<string, unknown> {
  const output: Record<string, unknown> = {
    name: error.name,
    message: error.message,
  };
  if (error.stack !== undefined) {
    output.stack = error.stack;
  }
  const cause = (error as { cause?: unknown }).cause;
  if (cause !== undefined) {
    output.cause = cause instanceof Error ? serializeError(cause) : cause;
  }
  return output;
}

/**
 * JSON.stringify that never throws: cycles become "[Circular]", BigInt
 * becomes a string, and Errors are serialized. Sinks use it so one bad
 * field cannot poison a whole batch.
 */
export function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return (
      JSON.stringify(value, (_key, item: unknown) => {
        if (typeof item === "bigint") {
          return item.toString();
        }
        if (item instanceof Error) {
          return serializeError(item);
        }
        if (item !== null && typeof item === "object") {
          if (seen.has(item)) {
            return "[Circular]";
          }
          seen.add(item);
        }
        return item;
      }) ?? "null"
    );
  } catch {
    return '"[unserializable]"';
  }
}

/**
 * Internal diagnostics bound at module load, before any console
 * capture, so loggerkit's own warnings can never feed back into a
 * captured console and loop.
 */
export const internalWarn: (...args: unknown[]) => void = console.warn.bind(console);
export const internalError: (...args: unknown[]) => void = console.error.bind(console);

/** Syslog severity (RFC 5424) for a level; shared by syslog and GELF. */
export function syslogSeverity(level: LogLevel): number {
  return SYSLOG_SEVERITY[level];
}

const SYSLOG_SEVERITY: Readonly<Record<LogLevel, number>> = {
  fatal: 2,
  error: 3,
  warn: 4,
  info: 6,
  debug: 7,
  trace: 7,
};

/** Sink construction options resolved by the factory. */
export interface LoggerKitOptions {
  name?: string;
  level?: LogLevel;
  sinks?: Sink[];
  formatter?: Formatter;
  /** Extra fields bound to every entry produced by this logger. */
  bindings?: Record<string, unknown>;
}

export class LoggerKitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoggerKitError";
  }
}

export class InvalidLevelError extends LoggerKitError {
  constructor(value: string | undefined | null) {
    super(`Invalid log level: ${String(value)}. Expected one of: ${LOG_LEVELS.join(", ")}.`);
    this.name = "InvalidLevelError";
  }
}

export class UnknownSinkError extends LoggerKitError {
  constructor(kind: string) {
    super(`Unknown sink kind: "${kind}".`);
    this.name = "UnknownSinkError";
  }
}

export class SinkClosedError extends LoggerKitError {
  constructor(name: string) {
    super(`Sink "${name}" is closed.`);
    this.name = "SinkClosedError";
  }
}

/**
 * Dynamically imports an optional peer dependency, resolving the CJS
 * module shape under Node interop. Throws a descriptive error when the
 * package is not installed.
 */
export async function importOptionalPeer<T = unknown>(moduleName: string): Promise<T> {
  let cause: unknown;
  try {
    const mod: unknown = await import(moduleName);
    return unwrapInterop<T>(mod);
  } catch (error) {
    cause = error;
  }
  const wrapper = new LoggerKitError(
    `Optional peer dependency "${moduleName}" is not installed. Install it to use this adapter.`,
  );
  wrapper.cause = cause;
  throw wrapper;
}

function unwrapInterop<T>(mod: unknown): T {
  const candidate = mod as { default?: T } | T;
  if (
    candidate !== null &&
    typeof candidate === "object" &&
    "default" in candidate &&
    (candidate as { default?: unknown }).default !== undefined
  ) {
    return (candidate as { default: T }).default;
  }
  return mod as T;
}
