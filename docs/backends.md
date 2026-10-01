# Backends

All backend sinks extend `BatchingSink`, use only `fetch` and Node builtins (loaded lazily), and never throw into your code. A failing backend retries with exponential backoff, then drops the batch and calls `onError` (default: `console.warn`).

## Shared batching options

| Option            | Default | Meaning                                              |
| ----------------- | ------- | ---------------------------------------------------- |
| `batchSize`       | 100     | Entries per request; a full batch flushes at once    |
| `flushIntervalMs` | 2000    | Max wait before a partial batch is sent              |
| `maxQueueSize`    | 10000   | Buffer while the backend is down; drops oldest first |
| `retries`         | 3       | Retries per batch after the first attempt            |
| `retryDelayMs`    | 250     | Base backoff (doubles per retry)                     |
| `onError`         | warn    | `(error, droppedEntries) => void`                    |

Always `await logger.close()` (or `flush()`) on shutdown so buffered entries are delivered.

## ELK stack

### Elasticsearch / OpenSearch directly

```ts
new ElasticsearchSink({
  node: "https://es.example.com:9200",
  apiKey: process.env.ES_API_KEY, // or username/password
  index: "logs-api-default", // data stream (uses `create` ops)
  // index: "api-{yyyy}.{MM}.{dd}", dataStream: false, // classic daily indices
  pipeline: "my-ingest-pipeline",
  serviceName: "api",
  environment: "production",
});
```

Documents follow ECS 8 (`@timestamp`, `log.level`, `log.logger`, `service.*`, `error.*`, `trace.id`, `span.id`), so Kibana Discover and Logs UI work without mappings. Item-level `_bulk` failures count as errors and are retried.

### Through Logstash

```ts
new LogstashSink({ protocol: "tcp", host: "logstash", port: 5000, type: "api", tags: ["prod"] });
```

```conf
input {
  tcp  { port => 5000 codec => json_lines }   # protocol: "tcp" / "tls"
  udp  { port => 5001 codec => json }         # protocol: "udp"
  http { port => 8080 }                       # protocol: "http", url: "http://logstash:8080"
}
output { elasticsearch { hosts => ["http://es:9200"] data_stream => true } }
```

## Grafana Loki

```ts
new LokiSink({
  url: "http://loki:3100",
  labels: { app: "api", env: "prod" }, // keep cardinality low
  labelKeys: ["tenant"], // promote selected context fields
  tenantId: "team-a", // X-Scope-OrgID
});
```

`level` and `logger` are always labels; the line is JSON, so `| json` works in LogQL.

## OpenTelemetry

```ts
new OtlpSink({
  endpoint: "http://otel-collector:4318",
  serviceName: "api",
  resource: { "deployment.environment": "prod" },
  headers: { "x-honeycomb-team": process.env.HONEYCOMB_KEY! },
});
```

Severity numbers follow the OTel spec (TRACE=1 … FATAL=21). `traceId`/`spanId` context fields become the record's trace context.

## Datadog

```ts
new DatadogSink({
  apiKey: process.env.DD_API_KEY!,
  site: "datadoghq.eu",
  service: "api",
  tags: ["env:prod"],
});
```

## Syslog

```ts
new SyslogSink({
  host: "logs.papertrailapp.com",
  port: 12345,
  protocol: "tls",
  appName: "api",
  facility: 16,
});
```

RFC 5424 messages; context goes into structured data `[meta@32473 key="value"]`. TCP/TLS use RFC 6587 octet counting.

## Graylog (GELF)

```ts
new GelfSink({ protocol: "udp", host: "graylog", port: 12201, source: "api" });
```

Context becomes `_`-prefixed additional fields. UDP messages over 8 KB are reduced to the core fields (chunking is not implemented — use TCP for large events).

## Splunk HEC

```ts
new SplunkSink({
  url: "https://splunk:8088",
  token: process.env.SPLUNK_HEC_TOKEN!,
  index: "main",
  sourcetype: "_json",
});
```

## Runtime support

| Sink                                                                | Node | Bun | Deno | Workers / edge |
| ------------------------------------------------------------------- | ---- | --- | ---- | -------------- |
| Elasticsearch, Loki, Datadog, OTLP, Splunk, HTTP-mode Logstash/GELF | ✓    | ✓   | ✓    | ✓              |
| TCP/TLS/UDP Logstash, GELF, Syslog                                  | ✓    | ✓   | ✓    | —              |
