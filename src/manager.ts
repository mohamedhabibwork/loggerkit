import { type LogLevel } from "./core.js";
import { createLogger, type CreateLoggerOptions } from "./factory.js";
import { Logger } from "./logger.js";

/**
 * Central registry of named loggers. Levels can be adjusted at runtime
 * per named logger or globally; children created through `child()` of a
 * managed logger inherit its live level via the manager on lookup.
 */
export class LogManager {
  private readonly loggers = new Map<string, Logger>();
  private readonly options: CreateLoggerOptions;
  private globalLevel?: LogLevel | string;

  constructor(options: CreateLoggerOptions = {}) {
    this.options = options;
  }

  get(name: string): Logger {
    const existing = this.loggers.get(name);
    if (existing !== undefined) {
      return existing;
    }
    const logger = createLogger({ ...this.options, name });
    if (this.globalLevel !== undefined) {
      logger.setLevel(this.globalLevel);
    }
    this.loggers.set(name, logger);
    return logger;
  }

  setLevel(name: string, level: LogLevel | string): void {
    this.get(name).setLevel(level);
  }

  setGlobalLevel(level: LogLevel | string): void {
    this.globalLevel = level;
    for (const logger of this.loggers.values()) {
      logger.setLevel(level);
    }
  }

  names(): string[] {
    return [...this.loggers.keys()];
  }

  async close(): Promise<void> {
    for (const logger of this.loggers.values()) {
      await logger.close();
    }
    this.loggers.clear();
  }
}
