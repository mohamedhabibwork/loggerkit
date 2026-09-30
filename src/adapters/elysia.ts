import type { Logger } from "../logger.js";

/**
 * Elysia plugin-compatible middleware that logs each request and
 * exposes the logger in `store.logger`. Return value is spread into an
 * Elysia instance: `new Elysia().use(elysiaLogger(logger))`.
 */
export function elysiaLogger(logger: Logger): ElysiaPlugin {
  return {
    name: "loggerkit",
    derive: () => ({ logger }),
    onRequest: async ({ request, set }: ElysiaContextLike, next: () => Promise<unknown>) => {
      const start = performance.now();
      try {
        const response = await next();
        const durationMs = Math.round(performance.now() - start);
        const path = new URL(request.url).pathname;
        logger.info(`${request.method} ${path}`, {
          status: readStatus(set),
          durationMs,
        });
        return response;
      } catch (error) {
        const durationMs = Math.round(performance.now() - start);
        const path = new URL(request.url).pathname;
        logger.error(`${request.method} ${path}`, {
          durationMs,
          ...(error instanceof Error ? { error } : { cause: String(error) }),
        });
        throw error;
      }
    },
  };
}

export interface ElysiaPlugin {
  name?: string;
  derive?: () => { logger: Logger };
  onRequest?: (context: ElysiaContextLike, next: () => Promise<unknown>) => Promise<unknown>;
}

export interface ElysiaContextLike {
  request: Request;
  set: Record<string, unknown>;
}

function readStatus(set: Record<string, unknown>): number | undefined {
  const status = set.status;
  return typeof status === "number" ? status : undefined;
}
