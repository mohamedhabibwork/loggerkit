import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Architecture guard: enforces the dependency direction
 *
 *   core ← sinks/formatters ← logger/composition ← adapters
 *
 * Every internal import of every src file must appear in the allow-list
 * below. Unmapped modules fail the test. Prefer fixing the dependency
 * direction over widening the allow-list. External imports are limited
 * to `node:` builtins, so optional peers can only be loaded through
 * `importOptionalPeer()`.
 */

const SRC_ROOT = path.resolve(import.meta.dirname, "../src");

const allowedImports: Record<string, string[]> = {
  "core.ts": [],
  "logger.ts": ["core.ts"],
  "factory.ts": [
    "core.ts",
    "logger.ts",
    "sinks/console.ts",
    "sinks/file.ts",
    "sinks/http.ts",
    "sinks/memory.ts",
    "sinks/datadog.ts",
    "sinks/elasticsearch.ts",
    "sinks/gelf.ts",
    "sinks/logstash.ts",
    "sinks/loki.ts",
    "sinks/otlp.ts",
    "sinks/splunk.ts",
    "sinks/syslog.ts",
  ],
  "manager.ts": ["core.ts", "factory.ts", "logger.ts"],
  "testing.ts": ["core.ts", "sinks/memory.ts"],
  "index.ts": [
    "core.ts",
    "logger.ts",
    "sinks/console.ts",
    "sinks/file.ts",
    "sinks/http.ts",
    "sinks/memory.ts",
    "formatters/json.ts",
    "formatters/pretty.ts",
    "formatters/ecs.ts",
    "formatters/logfmt.ts",
    "formatters/logstash.ts",
    "processors.ts",
    "sinks/batch.ts",
    "sinks/transport.ts",
    "sinks/datadog.ts",
    "sinks/elasticsearch.ts",
    "sinks/gelf.ts",
    "sinks/logstash.ts",
    "sinks/loki.ts",
    "sinks/otlp.ts",
    "sinks/splunk.ts",
    "sinks/syslog.ts",
    "factory.ts",
    "testing.ts",
  ],
  "pino-compat.ts": ["core.ts", "logger.ts", "sinks/console.ts"],
  "sinks/console.ts": ["core.ts"],
  "sinks/memory.ts": ["core.ts"],
  "sinks/file.ts": ["core.ts", "formatters/json.ts"],
  "sinks/http.ts": ["core.ts", "formatters/json.ts"],
  "formatters/json.ts": ["core.ts"],
  "formatters/pretty.ts": ["core.ts"],
  "formatters/ecs.ts": ["core.ts"],
  "formatters/logfmt.ts": ["core.ts"],
  "formatters/logstash.ts": ["core.ts"],
  "formatters/index.ts": [
    "formatters/json.ts",
    "formatters/pretty.ts",
    "formatters/ecs.ts",
    "formatters/logfmt.ts",
    "formatters/logstash.ts",
  ],
  "processors.ts": ["core.ts"],
  "context.ts": ["core.ts"],
  "sinks/batch.ts": ["core.ts"],
  "sinks/transport.ts": ["core.ts"],
  "sinks/elasticsearch.ts": [
    "core.ts",
    "formatters/ecs.ts",
    "sinks/batch.ts",
    "sinks/transport.ts",
  ],
  "sinks/logstash.ts": [
    "core.ts",
    "formatters/logstash.ts",
    "sinks/batch.ts",
    "sinks/transport.ts",
  ],
  "sinks/loki.ts": ["core.ts", "sinks/batch.ts", "sinks/transport.ts"],
  "sinks/datadog.ts": ["core.ts", "sinks/batch.ts", "sinks/transport.ts"],
  "sinks/otlp.ts": ["core.ts", "sinks/batch.ts", "sinks/transport.ts"],
  "sinks/syslog.ts": ["core.ts", "sinks/batch.ts", "sinks/transport.ts"],
  "sinks/gelf.ts": ["core.ts", "sinks/batch.ts", "sinks/transport.ts"],
  "sinks/splunk.ts": ["core.ts", "sinks/batch.ts", "sinks/transport.ts"],
  "adapters/pino.ts": ["core.ts", "logger.ts"],
  "adapters/consola.ts": ["core.ts", "logger.ts"],
  "adapters/debug.ts": ["core.ts", "logger.ts"],
  "adapters/express.ts": ["logger.ts"],
  "adapters/fastify.ts": ["core.ts", "logger.ts"],
  "adapters/nestjs.ts": ["core.ts", "logger.ts"],
  "adapters/console.ts": ["core.ts", "logger.ts"],
  "adapters/hono.ts": ["logger.ts"],
  "adapters/elysia.ts": ["logger.ts"],
  "adapters/winston.ts": ["core.ts", "logger.ts"],
  "adapters/loglevel.ts": ["logger.ts"],
  "adapters/bunyan.ts": ["logger.ts"],
  "adapters/log4js.ts": ["core.ts", "logger.ts"],
  "adapters/morgan.ts": ["logger.ts"],
  "adapters/roarr.ts": ["logger.ts"],
};

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

function sourceFiles(): Array<{ rel: string; file: string }> {
  return listSourceFiles(SRC_ROOT).map((file) => ({
    rel: path.relative(SRC_ROOT, file).replaceAll("\\", "/"),
    file,
  }));
}

const SPECIFIER_PATTERNS = [
  /(?:import|export)\s[^"'`]*?from\s+["']([^"']+)["']/g,
  /import\s*\(\s*["']([^"']+)["']\s*\)/g,
  /import\s+["']([^"']+)["']/g,
];

function collectSpecifiers(source: string): string[] {
  return SPECIFIER_PATTERNS.flatMap((pattern) =>
    [...source.matchAll(pattern)].map((match) => match[1] ?? ""),
  );
}

function normalize(specifier: string, fromFile: string): string | undefined {
  if (!specifier.startsWith(".")) {
    return undefined; // external or node: import
  }
  const resolved = path
    .relative(SRC_ROOT, path.resolve(path.dirname(fromFile), specifier))
    .replaceAll("\\", "/");
  const asTs = resolved.replace(/\.js$/, ".ts");
  return asTs.endsWith(".ts") ? asTs : `${asTs}.ts`;
}

describe("architecture guard", () => {
  it("every src file has an allow-list entry", () => {
    const unmapped = sourceFiles()
      .map(({ rel }) => rel)
      .filter((rel) => !(rel in allowedImports));
    expect(unmapped).toEqual([]);
  });

  it("internal imports respect the allow-list", () => {
    const violations: string[] = [];
    for (const { rel, file } of sourceFiles()) {
      for (const spec of collectSpecifiers(readFileSync(file, "utf8"))) {
        const normalized = normalize(spec, file);
        if (normalized === undefined) {
          continue;
        }
        if (!(allowedImports[rel] ?? []).includes(normalized)) {
          violations.push(`${rel} imports ${normalized}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("external imports are limited to node builtins (optional peers stay dynamic)", () => {
    const violations: string[] = [];
    for (const { rel, file } of sourceFiles()) {
      for (const spec of collectSpecifiers(readFileSync(file, "utf8"))) {
        if (spec.startsWith(".") || spec.startsWith("node:")) {
          continue;
        }
        violations.push(`${rel} imports ${spec}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("core is a leaf: imports nothing internal", () => {
    const source = readFileSync(path.join(SRC_ROOT, "core.ts"), "utf8");
    const internal = [...source.matchAll(/from\s+["'](\.[^"']+)["']/g)].map(
      (match) => match[1] ?? "",
    );
    expect(internal).toEqual([]);
  });
});
