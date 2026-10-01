import type { LogLevel } from "../core.js";
import type { Logger } from "../logger.js";

type ConsoleMethod = "log" | "info" | "warn" | "error" | "debug" | "trace";

const MAPPING: ReadonlyArray<[ConsoleMethod, LogLevel]> = [
  ["log", "info"],
  ["info", "info"],
  ["warn", "warn"],
  ["error", "error"],
  ["debug", "debug"],
  ["trace", "trace"],
];

/**
 * Routes `console.*` calls from third-party code into loggerkit. Returns a
 * restore function. Do not combine with a console sink on the same
 * logger, or output would loop — the patch guards against re-entry.
 */
export function captureConsole(logger: Logger, target: Console = console): () => void {
  const originals = new Map<ConsoleMethod, (...args: unknown[]) => void>();
  let reentrant = false;
  for (const [method, level] of MAPPING) {
    const original = target[method] as (...args: unknown[]) => void;
    originals.set(method, original);
    target[method] = (...args: unknown[]): void => {
      if (reentrant) {
        original.apply(target, args);
        return;
      }
      reentrant = true;
      try {
        const error = args.find((arg): arg is Error => arg instanceof Error);
        const message = args
          .filter((arg) => arg !== error)
          .map((arg) => (typeof arg === "string" ? arg : inspect(arg)))
          .join(" ");
        logger[level](
          message === "" && error !== undefined ? error.message : message,
          error === undefined ? {} : { error },
        );
      } finally {
        reentrant = false;
      }
    };
  }
  return () => {
    for (const [method, original] of originals) {
      target[method] = original;
    }
  };
}

function inspect(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
