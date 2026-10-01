import { LoggerKitError } from "../core.js";

export class TransportError extends LoggerKitError {
  readonly status?: number;
  /** False for permanent failures (bad request/credentials); batches are not retried. */
  readonly retryable: boolean;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "TransportError";
    this.status = status;
    this.retryable = status === undefined || isRetryableStatus(status);
  }
}

/** Network errors, 408, 429 and 5xx are worth retrying; other 4xx are not. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export interface HttpRequestOptions {
  url: string;
  body: string;
  headers?: Record<string, string>;
  method?: "POST" | "PUT";
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * POSTs via global `fetch` and returns the response body text (always
 * consumed, so pooled connections are released). Credentials embedded
 * in the URL are moved into a Basic auth header; errors never include
 * them. Throws `TransportError` on network failure or non-2xx.
 */
export async function sendHttp(options: HttpRequestOptions): Promise<string> {
  const { url, headers } = withUrlCredentials(options.url, options.headers);
  const safeUrl = redactUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method ?? "POST",
        headers,
        body: options.body,
        signal: controller.signal,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.name : "network error";
      throw new TransportError(`Request to ${safeUrl} failed (${reason})`);
    }
    const text = await response.text().catch(() => "");
    if (!response.ok) {
      const suffix = text ? `: ${text.slice(0, 200)}` : "";
      throw new TransportError(`HTTP ${response.status} from ${safeUrl}${suffix}`, response.status);
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function withUrlCredentials(
  rawUrl: string,
  headers: Record<string, string> = {},
): { url: string; headers: Record<string, string> } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { url: rawUrl, headers };
  }
  if (parsed.username === "" && parsed.password === "") {
    return { url: rawUrl, headers };
  }
  const username = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password);
  parsed.username = "";
  parsed.password = "";
  const hasAuth = Object.keys(headers).some((key) => key.toLowerCase() === "authorization");
  return {
    url: parsed.toString(),
    headers: hasAuth ? headers : { ...headers, authorization: basicAuth(username, password) },
  };
}

/** `Authorization: Basic ...` value, runtime-portable (no Buffer). */
export function basicAuth(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return `Basic ${btoa(binary)}`;
}

function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    return parsed.toString();
  } catch {
    return "<invalid url>";
  }
}

export type SocketProtocol = "tcp" | "tls" | "udp";

export interface SocketOptions {
  protocol: SocketProtocol;
  host: string;
  port: number;
  timeoutMs?: number;
}

/** Sends raw payloads over a lazily opened TCP/TLS connection or UDP socket. */
export interface SocketWriter {
  send(payload: string): Promise<void>;
  close(): Promise<void>;
}

interface StreamSocket {
  write(data: string, callback: (error?: Error | null) => void): boolean;
  once(event: string, listener: (...args: unknown[]) => void): unknown;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  end(callback?: () => void): unknown;
  destroy(): unknown;
  setKeepAlive?(enable: boolean, initialDelay: number): unknown;
}

interface StreamModule {
  connect(options: Record<string, unknown>): StreamSocket;
}

interface DgramSocket {
  send(data: string, port: number, host: string, callback: (error: Error | null) => void): void;
  close(callback?: () => void): void;
  unref?(): void;
}

/**
 * Node builtins are imported lazily so edge runtimes can still import
 * the package; only sending through a socket sink requires Node/Bun/Deno.
 */
export function createSocketWriter(options: SocketOptions): SocketWriter {
  return options.protocol === "udp" ? createUdpWriter(options) : createStreamWriter(options);
}

function createStreamWriter(options: SocketOptions): SocketWriter {
  let socket: Promise<StreamSocket> | undefined;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const connect = (): Promise<StreamSocket> => {
    if (socket !== undefined) {
      return socket;
    }
    const current: Promise<StreamSocket> = openStream(options, timeoutMs).then(
      (opened) => {
        // Only forget the connection this listener belongs to; a late
        // event from an old socket must not orphan its replacement.
        const forget = (): void => {
          if (socket === current) {
            socket = undefined;
          }
          opened.destroy();
        };
        opened.on("error", forget);
        opened.on("close", forget);
        return opened;
      },
      (error: unknown) => {
        if (socket === current) {
          socket = undefined;
        }
        throw error;
      },
    );
    socket = current;
    return current;
  };

  return {
    async send(payload) {
      const active = await connect();
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          active.write(payload, (error) => (error ? reject(error) : resolve()));
        }),
        timeoutMs,
        () => {
          active.destroy();
          return new TransportError(`Write to ${options.host}:${options.port} timed out`);
        },
      );
    },
    async close() {
      const active = await socket?.catch(() => undefined);
      socket = undefined;
      if (active !== undefined) {
        await withTimeout(
          new Promise<void>((resolve) => active.end(() => resolve())),
          timeoutMs,
          () => undefined,
        ).catch(() => undefined);
        active.destroy();
      }
    },
  };
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout: () => Error | undefined,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = onTimeout();
      if (error === undefined) {
        resolve(undefined as T);
      } else {
        reject(error);
      }
    }, ms);
    promise
      .then((value) => {
        resolve(value);
        return value;
      })
      .catch((error: unknown) => {
        reject(error instanceof Error ? error : new TransportError(String(error)));
      })
      .finally(() => clearTimeout(timer));
  });
}

function isIpAddress(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

async function openStream(options: SocketOptions, timeoutMs: number): Promise<StreamSocket> {
  const isTls = options.protocol === "tls";
  const module = (isTls
    ? await import("node:tls")
    : await import("node:net")) as unknown as StreamModule;
  return new Promise<StreamSocket>((resolve, reject) => {
    const socket = module.connect({
      host: options.host,
      port: options.port,
      ...(isTls && !isIpAddress(options.host) ? { servername: options.host } : {}),
    });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new TransportError(`Timed out connecting to ${options.host}:${options.port}`));
    }, timeoutMs);
    socket.once(isTls ? "secureConnect" : "connect", () => {
      clearTimeout(timer);
      socket.setKeepAlive?.(true, KEEP_ALIVE_MS);
      resolve(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      socket.destroy();
      reject(error instanceof Error ? error : new TransportError(String(error)));
    });
  });
}

const KEEP_ALIVE_MS = 30_000;

function createUdpWriter(options: SocketOptions): SocketWriter {
  let socket: Promise<DgramSocket> | undefined;
  const open = async (): Promise<DgramSocket> => {
    const dgram = (await import("node:dgram")) as unknown as {
      createSocket(type: string): DgramSocket;
    };
    const created = dgram.createSocket(options.host.includes(":") ? "udp6" : "udp4");
    created.unref?.();
    return created;
  };
  return {
    async send(payload) {
      socket ??= open();
      const active = await socket;
      await new Promise<void>((resolve, reject) => {
        active.send(payload, options.port, options.host, (error) =>
          error ? reject(error) : resolve(),
        );
      });
    },
    async close() {
      const active = await socket;
      socket = undefined;
      if (active !== undefined) {
        await new Promise<void>((resolve) => active.close(() => resolve()));
      }
    },
  };
}
