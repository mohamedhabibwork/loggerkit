import { importOptionalPeer, parseLevel, type LogLevel } from "../core.js";
import type { Logger } from "../logger.js";

interface WinstonTransportCtor {
  new (options?: Record<string, unknown>): WinstonTransportLike;
}

interface WinstonTransportLike {
  log(info: Record<string, unknown>, callback: () => void): void;
}

/**
 * Creates a winston Transport that forwards winston logs into a
 * loggerkit Logger. Requires `winston` to be installed (optional peer
 * dependency); it is loaded lazily.
 *
 * Usage: `winston.add(await createWinstonTransport(logger))`.
 */
export async function createWinstonTransport(logger: Logger): Promise<WinstonTransportLike> {
  const winston = await importOptionalPeer<{ Transport: WinstonTransportCtor }>("winston");
  const Transport = winston.Transport;
  class LoggerKitWinstonTransport extends Transport {
    constructor(options?: Record<string, unknown>) {
      super({ level: "trace", ...options });
    }

    log(info: Record<string, unknown>, callback: () => void): void {
      const level = normalize(info.level);
      const splatKey: string = Symbol.for("splat").toString();
      const splat = info[splatKey] as unknown[] | undefined;
      const message = typeof info.message === "string" ? info.message : String(info.message);
      const fields: Record<string, unknown> = {
        ...(splat !== undefined && splat.length > 0 ? { splat } : {}),
        ...withoutMeta(info),
      };
      if (info.stack instanceof Error) {
        logger[level](message, { error: info.stack });
      } else if (info.error instanceof Error) {
        logger[level](message, { error: info.error });
      } else {
        logger[level](message, fields);
      }
      callback();
    }
  }
  return new LoggerKitWinstonTransport();
}

function normalize(level: unknown): LogLevel {
  if (typeof level === "string") {
    const lower = level.toLowerCase();
    if (lower === "verbose" || lower === "silly") {
      return "trace";
    }
    if (lower === "http") {
      return "info";
    }
    try {
      return parseLevel(lower);
    } catch {
      return "info";
    }
  }
  return "info";
}

function withoutMeta(info: Record<string, unknown>): Record<string, unknown> {
  const { level: _level, message: _message, stack: _stack, error: _error, ...rest } = info;
  return rest;
}
