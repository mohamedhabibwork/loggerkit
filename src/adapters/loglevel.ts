import type { Logger } from "../logger.js";

export interface LoglevelAdapter {
  trace: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

/**
 * Method mapping to install on a loglevel instance:
 *
 * ```ts
 * const log = loglevel.getLogger("app");
 * Object.assign(log, createLoglevelMethods(logger));
 * ```
 */
export function createLoglevelMethods(logger: Logger): LoglevelAdapter {
  return {
    trace: (...args: unknown[]) => logger.trace(render(args)),
    debug: (...args: unknown[]) => logger.debug(render(args)),
    info: (...args: unknown[]) => logger.info(render(args)),
    warn: (...args: unknown[]) => logger.warn(render(args)),
    error: (...args: unknown[]) => logger.error(render(args)),
  };
}

function render(args: unknown[]): string {
  return args
    .map((arg) =>
      arg instanceof Error
        ? arg.message
        : typeof arg === "string"
          ? arg
          : (JSON.stringify(arg) ?? String(arg)),
    )
    .join(" ");
}
