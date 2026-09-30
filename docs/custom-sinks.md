# Custom sinks

A sink is any object satisfying the core `Sink` interface:

```ts
interface Sink {
  readonly name: string;
  write(entry: LogEntry): void | Promise<void>;
  flush?(): void | Promise<void>;
  close?(): void | Promise<void>;
}
```

Example: a Slack sink.

```ts
import { createLogger } from "@mohamedhabibwork/loggerkit/factory";
import { jsonFormatter } from "@mohamedhabibwork/loggerkit/formatters";

const slackSink = {
  name: "slack",
  write(entry) {
    if (entry.level === "error" || entry.level === "fatal") {
      void fetch(process.env.SLACK_WEBHOOK_URL!, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: jsonFormatter()(entry) }),
      });
    }
  },
};

const logger = createLogger({ sinks: [{ kind: "console" }, slackSink] });
```

Contract notes:

- `write` is called synchronously by the logger; rejections from returned promises are reported through `onError` and never crash the app.
- Sinks receive only level-passed entries; add per-sink filtering with `minLevel` semantics in your own sink if needed.
- `flush()` is awaited by `Logger.flush()`; make it idempotent.
- `close()` is called once by `Logger.close()`; after close a sink may reject further writes with `SinkClosedError`.
