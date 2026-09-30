import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import path from "node:path";
import { type Formatter, type LogEntry, type Sink, SinkClosedError } from "../core.js";
import { jsonFormatter } from "../formatters/json.js";

export interface FileSinkOptions {
  /** Target file path. Parent directories are created on first write. */
  filePath: string;
  name?: string;
  formatter?: Formatter;
  /** When set, the file is rotated before the write that would exceed this size in bytes. */
  maxBytes?: number;
  /** Number of rotated files kept (`.1`, `.2`, ...). Defaults to 5. */
  maxFiles?: number;
}

/**
 * Appends rendered entries to a file. With `maxBytes`, performs
 * size-based rotation by shifting `file.1` ... `file.N` — zero external
 * dependencies. Writes are serialized through an internal promise chain
 * so concurrent `write` calls cannot interleave.
 */
export class FileSink implements Sink {
  readonly name: string;
  private readonly filePath: string;
  private readonly formatter: Formatter;
  private readonly maxBytes?: number;
  private readonly maxFiles: number;
  private closed = false;
  private chain: Promise<void> = Promise.resolve();

  constructor(options: FileSinkOptions) {
    this.name = options.name ?? "file";
    this.filePath = options.filePath;
    this.formatter = options.formatter ?? jsonFormatter();
    this.maxBytes = options.maxBytes;
    this.maxFiles = options.maxFiles ?? 5;
  }

  write(entry: LogEntry): Promise<void> {
    if (this.closed) {
      throw new SinkClosedError(this.name);
    }
    const line = `${this.formatter(entry)}\n`;
    const next = this.chain.then(() => this.appendLine(line));
    this.chain = next.catch(() => undefined);
    return next;
  }

  async flush(): Promise<void> {
    await this.chain;
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.chain;
  }

  private async appendLine(line: string): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    if (
      this.maxBytes !== undefined &&
      (await fileSize(this.filePath)) + line.length > this.maxBytes
    ) {
      await this.rotate();
    }
    await appendFile(this.filePath, line, "utf8");
  }

  private async rotate(): Promise<void> {
    if (await fileExists(this.filePath)) {
      for (let index = this.maxFiles - 1; index >= 1; index -= 1) {
        await renameSafe(rotatedPath(this.filePath, index), rotatedPath(this.filePath, index + 1));
      }
      await renameSafe(this.filePath, rotatedPath(this.filePath, 1));
    }
  }
}

function rotatedPath(filePath: string, index: number): string {
  return `${filePath}.${index}`;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function fileSize(filePath: string): Promise<number> {
  try {
    const info = await stat(filePath);
    return info.size;
  } catch {
    return 0;
  }
}

async function renameSafe(from: string, to: string): Promise<void> {
  if (await fileExists(from)) {
    await rename(from, to).catch(() => undefined);
  }
}
