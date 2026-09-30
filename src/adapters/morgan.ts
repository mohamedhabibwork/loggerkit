import type { Logger } from "../logger.js";

export interface MorganStreamLike {
  write: (line: string) => void;
}

/**
 * Stream adapter for morgan: pass as `{ stream }` in morgan options.
 * Parses the default combined/common line format into method, path,
 * status, and duration fields when present.
 */
export function createMorganStream(logger: Logger): MorganStreamLike {
  return {
    write(line: string): void {
      const text = line.trimEnd();
      const parsed = parse(text);
      logger.info(parsed.message, parsed.fields);
    },
  };
}

interface ParsedLine {
  message: string;
  fields: Record<string, unknown>;
}

export function parse(line: string): ParsedLine {
  // e.g. `GET /users 200 12.345 ms - 156` or full combined format
  const match = /^([A-Z]+) (\S+) (\d{3})(?: (\d+(?:\.\d+)?) ms)?/.exec(line);
  if (match === null) {
    return { message: line, fields: {} };
  }
  const [, method, path, status, durationMs] = match;
  return {
    message: `${method} ${path}`,
    fields: {
      status: Number(status),
      ...(durationMs !== undefined ? { durationMs: Number(durationMs) } : {}),
    },
  };
}
