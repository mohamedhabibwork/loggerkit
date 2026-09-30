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
