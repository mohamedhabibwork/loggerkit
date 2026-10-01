import {
  contextFields,
  safeStringify,
  serializeError,
  type Formatter,
  type LogEntry,
} from "../core.js";

export interface LogstashFormatterOptions {
  /** Added as `type`, handy for Logstash `if [type] == ...` routing. */
  type?: string;
  /** Static fields on every event (e.g. `{ app: "api", env: "prod" }`). */
  fields?: Record<string, unknown>;
  /** Tags appended to `tags`. */
  tags?: string[];
}

/** Logstash `json_event` shape (`@timestamp`, `@version`, `message`, ...). */
export function toLogstashEvent(
  entry: LogEntry,
  options: LogstashFormatterOptions = {},
): Record<string, unknown> {
  const event: Record<string, unknown> = {
    ...options.fields,
    ...contextFields(entry),
    "@timestamp": entry.time.toISOString(),
    "@version": "1",
    message: entry.message,
    level: entry.level,
  };
  if (entry.name !== undefined) {
    event.logger_name = entry.name;
  }
  if (options.type !== undefined) {
    event.type = options.type;
  }
  if (options.tags !== undefined && options.tags.length > 0) {
    event.tags = options.tags;
  }
  if (entry.error !== undefined) {
    event.error = serializeError(entry.error);
  }
  return event;
}

/** Newline-delimited Logstash events, for the `json_lines` codec. */
export function logstashFormatter(options: LogstashFormatterOptions = {}): Formatter {
  return (entry) => safeStringify(toLogstashEvent(entry, options));
}
