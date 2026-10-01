import type { LogLevel } from "../core.js";
import type { Logger } from "../logger.js";

/** Shape consola passes to reporters. */
export interface ConsolaLogObject {
  level: number;
  type?: string;
  tag?: string;
  args?: unknown[];
  message?: string;
  date?: Date;
}

export interface ConsolaReporter {
  log(logObj: ConsolaLogObject): void;
}

/** consola reporter: `consola.setReporters([createConsolaReporter(logger)])`. */
export function createConsolaReporter(logger: Logger): ConsolaReporter {
  return {
    log(logObj: ConsolaLogObject): void {
      const args = logObj.args ?? [];
      const error = args.find((arg): arg is Error => arg instanceof Error);
      const parts = args.filter((arg) => !(arg instanceof Error));
      const message =
        logObj.message ??
        parts.map((arg) => (typeof arg === "string" ? arg : safeJson(arg))).join(" ");
      const fields: Record<string, unknown> = {
        ...(logObj.tag ? { tag: logObj.tag } : {}),
        ...(logObj.type ? { type: logObj.type } : {}),
        ...(error === undefined ? {} : { error }),
      };
      logger[toLevel(logObj)](message, fields);
    },
  };
}

function toLevel(logObj: ConsolaLogObject): LogLevel {
  if (logObj.type === "fatal") {
    return "fatal";
  }
  if (logObj.level <= 0) {
    return "error";
  }
  if (logObj.level === 1) {
    return "warn";
  }
  if (logObj.level <= 3) {
    return "info";
  }
  return logObj.level === 4 ? "debug" : "trace";
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
