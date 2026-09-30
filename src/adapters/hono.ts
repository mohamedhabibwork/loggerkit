import type { Logger } from "../logger.js";

export interface HonoLoggerVariables {
  logger: Logger;
}

export interface HonoContextLike {
  req: { method: string; path: string };
  res: { status: number };
  set(key: string, value: unknown): void;
}

export interface HonoNextLike {
  (): Promise<void> | void;
}

export interface HonoMiddleware {
  (c: HonoContextLike, next: HonoNextLike): Promise<void>;
}

/**
 * Hono middleware that logs every request (method, path, status,
 * durationMs) and exposes the logger via `c.set("logger", logger)`.
 *
 * Usage: `app.use(requestLogger(logger))`.
 */
export function requestLogger(logger: Logger): HonoMiddleware {
  return async (c: HonoContextLike, next: HonoNextLike): Promise<void> => {
    const start = performance.now();
    c.set("logger", logger);
    try {
      await next();
    } catch (error) {
      const durationMs = Math.round(performance.now() - start);
      logger.error(`${c.req.method} ${c.req.path}`, {
        durationMs,
        ...(error instanceof Error ? { error } : { cause: String(error) }),
      });
      throw error;
    }
    const durationMs = Math.round(performance.now() - start);
    logger.info(`${c.req.method} ${c.req.path}`, {
      status: c.res.status,
      durationMs,
    });
  };
}
