import type { LogLevel } from "../core.js";
import type { Logger } from "../logger.js";

type NestLogLevel = "log" | "error" | "warn" | "debug" | "verbose" | "fatal";

/**
 * NestJS `LoggerService` backed by loggerkit (no @nestjs dependency):
 *
 * ```ts
 * const app = await NestFactory.create(AppModule, { bufferLogs: true });
 * app.useLogger(new NestLoggerService(logger));
 * ```
 *
 * Nest passes the context (class name) as the last string argument; it
 * becomes the `context` field.
 */
export class NestLoggerService {
  constructor(private readonly logger: Logger) {}

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.emit("info", message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.emit("error", message, optionalParams, true);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.emit("warn", message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.emit("debug", message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.emit("trace", message, optionalParams);
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.emit("fatal", message, optionalParams, true);
  }

  /** Maps Nest's enabled levels onto the lowest matching loggerkit level. */
  setLogLevels(levels: NestLogLevel[]): void {
    const order: Array<[NestLogLevel, LogLevel]> = [
      ["verbose", "trace"],
      ["debug", "debug"],
      ["log", "info"],
      ["warn", "warn"],
      ["error", "error"],
      ["fatal", "fatal"],
    ];
    const lowest = order.find(([nest]) => levels.includes(nest));
    if (lowest !== undefined) {
      this.logger.setLevel(lowest[1]);
    }
  }

  private emit(level: LogLevel, message: unknown, params: unknown[], hasStack = false): void {
    const rest = [...params];
    const last = rest.at(-1);
    // A lone multi-line string after an error message is a stack, not a context.
    const isStack =
      hasStack && rest.length === 1 && typeof last === "string" && last.includes("\n");
    const context = typeof last === "string" && !isStack ? rest.pop() : undefined;
    const fields: Record<string, unknown> = context === undefined ? {} : { context };
    if (hasStack && typeof rest[0] === "string" && rest[0].includes("\n")) {
      fields.stack = rest.shift();
    }
    if (message instanceof Error) {
      fields.error = message;
    } else if (message !== null && typeof message === "object") {
      Object.assign(fields, message);
    }
    if (rest.length > 0) {
      fields.params = rest;
    }
    const text =
      message instanceof Error ? message.message : typeof message === "string" ? message : "";
    this.logger[level](text, fields);
  }
}
