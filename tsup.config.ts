import { defineConfig } from "tsup";

const entries = [
  "src/index.ts",
  "src/sinks/console.ts",
  "src/sinks/memory.ts",
  "src/sinks/file.ts",
  "src/sinks/http.ts",
  "src/formatters/index.ts",
  "src/factory.ts",
  "src/manager.ts",
  "src/pino-compat.ts",
  "src/adapters/hono.ts",
  "src/adapters/elysia.ts",
  "src/adapters/winston.ts",
  "src/adapters/loglevel.ts",
  "src/adapters/bunyan.ts",
  "src/adapters/log4js.ts",
  "src/adapters/morgan.ts",
  "src/adapters/roarr.ts",
  "src/testing.ts",
];

export default defineConfig({
  entry: entries,
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  target: "es2022",
  external: ["hono", "elysia", "winston", "loglevel", "bunyan", "log4js", "morgan", "roarr"],
});
