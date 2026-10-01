import type { LogLevel } from "../core.js";
import type { Logger } from "../logger.js";

type PinoLevel = LogLevel | "silent";
type LogFn = (objOrMsg?: unknown, msg?: string, ...rest: unknown[]) => void;

/** pino-compatible logger shape Fastify accepts as `loggerInstance`. */
export interface FastifyLoggerInstance extends Record<LogLevel | "silent", LogFn> {
  level: string;
  child(bindings: Record<string, unknown>, options?: { level?: string }): FastifyLoggerInstance;
}

/**
 * Wraps a loggerkit Logger as a Fastify logger:
 * `Fastify({ loggerInstance: toFastifyLogger(logger) })` (Fastify ≥ 5)
 * or `Fastify({ logger: toFastifyLogger(logger) })` (Fastify 4).
 */
export function toFastifyLogger(logger: Logger): FastifyLoggerInstance {
  const emit =
    (level: LogLevel): LogFn =>
    (objOrMsg, msg, ...rest) => {
      if (typeof objOrMsg === "string") {
        logger[level](format(objOrMsg, [msg, ...rest]));
        return;
      }
      if (objOrMsg instanceof Error) {
        logger[level](msg ?? objOrMsg.message, { error: objOrMsg });
        return;
      }
      const fields = normalizeFields(objOrMsg);
      logger[level](msg === undefined ? "" : format(msg, rest), fields);
    };

  const instance: FastifyLoggerInstance = {
    get level(): string {
      return logger.level;
    },
    set level(value: string) {
      if (value !== "silent") {
        logger.setLevel(value);
      }
    },
    trace: emit("trace"),
    debug: emit("debug"),
    info: emit("info"),
    warn: emit("warn"),
    error: emit("error"),
    fatal: emit("fatal"),
    silent: () => {},
    child(bindings, options) {
      const child = toFastifyLogger(logger.child("", bindings));
      if (options?.level !== undefined) {
        child.level = options.level as PinoLevel;
      }
      return child;
    },
  };
  return instance;
}

function normalizeFields(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object") {
    return value === undefined ? {} : { value };
  }
  const { err, req, res, ...fields } = value as Record<string, unknown>;
  if (err instanceof Error) {
    fields.error = err;
  }
  // Fastify passes raw (circular) request/reply objects; keep pino's default shape.
  if (req !== undefined) {
    fields.req = serializeRequest(req);
  }
  if (res !== undefined) {
    fields.res = serializeReply(res);
  }
  return fields;
}

function serializeRequest(req: unknown): Record<string, unknown> {
  const value = (req ?? {}) as Record<string, unknown>;
  return {
    method: value.method,
    url: typeof value.url === "string" ? value.url.split("?")[0] : value.url,
    ...(value.id === undefined ? {} : { id: value.id }),
    ...(value.ip === undefined ? {} : { remoteAddress: value.ip }),
  };
}

function serializeReply(res: unknown): Record<string, unknown> {
  const value = (res ?? {}) as Record<string, unknown>;
  return { statusCode: value.statusCode };
}

function format(message: string, args: unknown[]): string {
  const values = args.filter((arg) => arg !== undefined);
  let index = 0;
  const formatted = message.replace(/%[sdjo]/g, (token) => {
    if (index >= values.length) {
      return token;
    }
    const value = values[index++];
    return token === "%j" || token === "%o" ? JSON.stringify(value) : String(value);
  });
  return index < values.length
    ? `${formatted} ${values.slice(index).map(String).join(" ")}`
    : formatted;
}
