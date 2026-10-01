import type { LogLevel } from "../core.js";
import type { Logger } from "../logger.js";

/**
 * Replacement for `debug.log` so output from the `debug` package (used by
 * express, socket.io, mongoose, ...) flows through loggerkit:
 *
 * ```ts
 * // createDebug is the default export of the `debug` package
 * createDebug.log = createDebugLog(logger);
 * ```
 */
export function createDebugLog(
  logger: Logger,
  level: LogLevel = "debug",
): (this: { namespace?: string } | void, ...args: unknown[]) => void {
  return function log(this: { namespace?: string } | void, ...args: unknown[]): void {
    const namespace =
      this !== undefined && this !== null && typeof this === "object" ? this.namespace : undefined;
    const message = args
      .map((arg) => (typeof arg === "string" ? stripAnsi(arg) : String(arg)))
      .join(" ")
      .trim();
    logger[level](message, namespace === undefined ? {} : { namespace });
  };
}

function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}
