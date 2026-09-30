import type { Logger } from "../logger.js";

export interface RoarrMessageLike {
  message: string;
  level?: number;
  context?: Record<string, unknown>;
  time?: number;
  name?: string;
}

/**
 * Roarr-to-loggerkit sink. Roarr messages are structured objects; this
 * adapter maps the numeric level and context into LogEntry fields.
 *
 * Usage: with roarr's `ROARR.write = createRoarrSink(logger)`.
 */
export function createRoarrSink(logger: Logger): (message: string) => void {
  return (message: string): void => {
    let parsed: RoarrMessageLike;
    try {
      parsed = JSON.parse(message) as RoarrMessageLike;
    } catch {
      logger.warn("roarr: unparseable message", { raw: message });
      return;
    }
    const level = roarrLevel(parsed.level ?? 32);
    const { message: text, level: _level, context, ...rest } = parsed;
    logger[level](text ?? "", { ...context, ...rest });
  };
}

function roarrLevel(level: number): "trace" | "debug" | "info" | "warn" | "error" | "fatal" {
  // Roarr levels: 10 log, 20 debug, 30 info... its base is 10=log;
  // map by proximity: <15 trace, <25 debug, <35 info, <45 warn, <55 error, else fatal
  if (level < 15) {
    return "trace";
  }
  if (level < 25) {
    return "debug";
  }
  if (level < 35) {
    return "info";
  }
  if (level < 45) {
    return "warn";
  }
  if (level < 55) {
    return "error";
  }
  return "fatal";
}
