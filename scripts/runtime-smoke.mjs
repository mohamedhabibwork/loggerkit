import { Logger, MemorySink } from "../dist/index.js";
import { createLogger } from "../dist/factory.js";

const sink = new MemorySink();
const logger = new Logger({ sinks: [sink] });
logger.info("smoke", { ok: true });

const entries = sink.entries();
if (entries.length !== 1 || entries[0]?.message !== "smoke" || typeof createLogger !== "function") {
  throw new Error("runtime smoke failed");
}

const label = typeof Deno === "undefined" ? "node/bun" : "deno";
console.log(`runtime smoke ok (${label})`);
