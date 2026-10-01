# Security policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | yes       |

## Reporting a vulnerability

Open a private security advisory via GitHub ("Report a vulnerability" on the Security tab) rather than a public issue. Please include a minimal reproduction and affected versions.

## Notes

- The HTTP sink sends whatever the application logs to the configured endpoint — do not log secrets, and set auth headers via `HttpSinkOptions.headers`.
- `LLM_SECRET`-style environment variables are never read automatically; loggerkit has no runtime dependencies and performs no network calls except through an explicitly configured HTTP sink.

## Socket sinks (syslog / GELF / Logstash over TCP, TLS, UDP)

- **TLS**: `protocol: "tls"` pins `minVersion: TLSv1.2` and keeps certificate verification on (`rejectUnauthorized: true`). Pass a private CA via `tls: { ca }`; `tls: { rejectUnauthorized: false }` exists only for local testing.
- **Target validation**: host and port are validated at sink construction — empty hosts, hosts containing whitespace or control characters, and out-of-range ports throw `TransportError` immediately instead of at first write.
- **UDP limits**: datagrams larger than 65507 bytes are rejected with a clear `TransportError` (GELF additionally truncates to 8 KB before sending).
- **Backpressure**: TCP/TLS writes honor the socket's high-water mark (wait for `drain`) and every write is bounded by `timeoutMs`, so a slow receiver cannot grow memory without bound.
- **SNI**: for TLS, `servername` is set for hostname targets (skipped for literal IPs), so modern certificate verification works out of the box.
