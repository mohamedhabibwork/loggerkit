import type { Logger } from "../logger.js";

export interface BunyanStreamLike {
  name: string;
  level: number | string;
  type?: string;
  stream?: NodeJS.WritableStream;
  write(record: Record<string, unknown>): void;
}

const BUNYAN_LEVEL_NAMES = ["trace", "debug", "info", "warn", "error", "fatal"] as const;

/**
 * Bunyan raw stream that routes records into loggerkit. Add it as
 * `{ level: "trace", type: "raw", stream: createBunyanStream(logger) }`
 * in bunyan's `streams` array.
 */
export function createBunyanStream(logger: Logger, level: number | string = 0): BunyanStreamLike {
  return {
    name: "loggerkit",
    level,
    type: "raw",
    write(record: Record<string, unknown>): void {
      const bunyanLevel = typeof record.level === "number" ? record.level : 30;
      const levelName =
        BUNYAN_LEVEL_NAMES[Math.min(Math.max(bunyanLevel / 10 - 1, 0), 5)] ?? "info";
      const message = typeof record.msg === "string" ? record.msg : "";
      const {
        level: _level,
        msg: _msg,
        time: _time,
        v: _v,
        pid: _pid,
        hostname: _hostname,
        name: _name,
        ...fields
      } = record;
      if (record.err instanceof Error) {
        logger[levelName](message, { error: record.err });
      } else {
        logger[levelName](message, fields);
      }
    },
  };
}
