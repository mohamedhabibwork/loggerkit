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

/** Renders a LogEntry into a string (or any serializable value) for a sink. */
export type Formatter = (entry: LogEntry) => string;

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
