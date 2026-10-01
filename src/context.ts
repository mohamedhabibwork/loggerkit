import { AsyncLocalStorage } from "node:async_hooks";
import type { ContextProvider } from "./core.js";

/**
 * Async-context propagation for request-scoped fields (request id,
 * tenant, trace ids). Backed by `AsyncLocalStorage`, available in Node,
 * Bun, Deno and Cloudflare Workers (with `nodejs_compat`).
 *
 * ```ts
 * const context = createLogContext();
 * const logger = createLogger({ contextProvider: context.provider });
 * context.run({ requestId }, () => handle(req)); // every log inside gets requestId
 * ```
 */
export interface LogContext {
  /** Runs `fn` with `fields` merged over the current context. */
  run<T>(fields: Record<string, unknown>, fn: () => T): T;
  /** Adds fields to the active context (no-op outside `run`). */
  assign(fields: Record<string, unknown>): void;
  /** Current fields, or undefined outside `run`. */
  get(): Readonly<Record<string, unknown>> | undefined;
  /** Pass as `contextProvider` to a Logger. */
  readonly provider: ContextProvider;
}

export function createLogContext(): LogContext {
  const storage = new AsyncLocalStorage<{ fields: Record<string, unknown> }>();
  const get = (): Readonly<Record<string, unknown>> | undefined => storage.getStore()?.fields;
  return {
    run: (fields, fn) => storage.run({ fields: { ...get(), ...fields } }, fn),
    assign: (fields) => {
      const store = storage.getStore();
      if (store !== undefined) {
        store.fields = { ...store.fields, ...fields };
      }
    },
    get,
    provider: get,
  };
}
