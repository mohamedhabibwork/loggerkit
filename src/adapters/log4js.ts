import { importOptionalPeer } from "../core.js";
import type { Logger } from "../logger.js";

interface Log4jsLevels {
  severity: Record<string, number>;
  getLevel: (name: string) => { level: number; levelStr: string };
}

interface Log4jsModule {
  levels: Log4jsLevels;
  addAppender: (appender: unknown, name?: string) => void;
}

interface Log4jsEventLike {
  level: { levelStr: string };
  categoryName: string;
  data: unknown[];
  startTime: Date;
}

export interface Log4jsAppenderOptions {
  /** Appender name registered via `log4js.addAppender(appender, name)`. */
  name?: string;
}

/**
 * Creates a log4js appender function that forwards events into
 * loggerkit, and (when `register` is true) attaches it to the installed
 * log4js instance. Requires `log4js` (optional peer dependency).
 */
export async function createLog4jsAppender(
  logger: Logger,
  options: Log4jsAppenderOptions = {},
): Promise<(event: Log4jsEventLike) => void> {
  const appender = (event: Log4jsEventLike): void => {
    const message = event.data.map(render).join(" ");
    const level = normalize(event.level.levelStr);
    const first = event.data.find((item) => item instanceof Error);
    if (first instanceof Error) {
      logger[level](message, { error: first, category: event.categoryName });
    } else {
      logger[level](message, { category: event.categoryName });
    }
  };
  if (options.name !== undefined) {
    const log4js = await importOptionalPeer<Log4jsModule>("log4js");
    log4js.addAppender(appender, options.name);
  }
  return appender;
}

function normalize(levelStr: string): "trace" | "debug" | "info" | "warn" | "error" | "fatal" {
  const lower = levelStr.toLowerCase();
  if (
    lower === "trace" ||
    lower === "debug" ||
    lower === "info" ||
    lower === "warn" ||
    lower === "error" ||
    lower === "fatal"
  ) {
    return lower;
  }
  return "info";
}

function render(item: unknown): string {
  if (item instanceof Error) {
    return item.message;
  }
  if (typeof item === "string") {
    return item;
  }
  try {
    return JSON.stringify(item) ?? String(item);
  } catch {
    return String(item);
  }
}
