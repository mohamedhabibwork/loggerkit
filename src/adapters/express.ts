import type { Logger } from "../logger.js";

interface RequestLike {
  method?: string;
  originalUrl?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
  log?: Logger;
}

interface ResponseLike {
  statusCode?: number;
  setHeader?(name: string, value: string): unknown;
  once(event: "finish" | "close", listener: () => void): unknown;
}

export interface ExpressLoggerOptions {
  /** Header carrying an incoming request id; defaults to `x-request-id`. */
  requestIdHeader?: string;
  /** Generates ids when the header is absent; defaults to `crypto.randomUUID`. */
  generateId?: () => string;
  /** Include the query string in `path`; off by default because it often carries tokens. */
  includeQuery?: boolean;
  /** Skip logging for some requests (e.g. health checks). */
  ignore?: (req: RequestLike) => boolean;
}

/**
 * Express/Connect middleware: attaches `req.log` (a child logger bound to
 * the request id) and logs one line per completed request, at `error`
 * for 5xx, `warn` for 4xx, `info` otherwise.
 */
export function expressLogger(
  logger: Logger,
  options: ExpressLoggerOptions = {},
): (req: RequestLike, res: ResponseLike, next: () => void) => void {
  const header = (options.requestIdHeader ?? "x-request-id").toLowerCase();
  const generateId = options.generateId ?? (() => crypto.randomUUID());
  return (req, res, next) => {
    const incoming = req.headers?.[header];
    const requestId = (Array.isArray(incoming) ? incoming[0] : incoming) ?? generateId();
    req.log = logger.child("", { requestId });
    res.setHeader?.(header, requestId);
    if (options.ignore?.(req) === true) {
      next();
      return;
    }
    const startedAt = performance.now();
    let done = false;
    const finish = (aborted: boolean): void => {
      if (done) {
        return;
      }
      done = true;
      const status = res.statusCode ?? 0;
      const rawPath = req.originalUrl ?? req.url;
      const fields = {
        method: req.method,
        path: options.includeQuery === true ? rawPath : rawPath?.split("?")[0],
        status,
        durationMs: Math.round(performance.now() - startedAt),
        ...(req.ip === undefined ? {} : { ip: req.ip }),
        ...(aborted ? { aborted: true } : {}),
      };
      const message = `${req.method ?? "?"} ${fields.path ?? "?"} ${status}`;
      if (status >= 500) {
        req.log?.error(message, fields);
      } else if (status >= 400 || aborted) {
        req.log?.warn(message, fields);
      } else {
        req.log?.info(message, fields);
      }
    };
    res.once("finish", () => finish(false));
    res.once("close", () => finish(true));
    next();
  };
}
