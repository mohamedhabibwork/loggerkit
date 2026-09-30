import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const require = createRequire(import.meta.url);

let targets = 0;
for (const [key, entry] of Object.entries(pkg.exports)) {
  if (key === "./package.json") {
    continue;
  }
  for (const field of ["types", "import", "require"]) {
    const target = entry[field];
    if (typeof target !== "string") {
      throw new Error(`${key}: missing "${field}" target`);
    }
    if (!existsSync(path.join(root, target))) {
      throw new Error(`${key}: ${field} target does not exist: ${target}`);
    }
    targets += 1;
  }
}

const esm = await import(pathToFileURL(path.join(root, "dist/index.js")).href);
if (typeof esm.Logger !== "function") {
  throw new Error("ESM root export is missing Logger");
}
const cjs = require(path.join(root, "dist/index.cjs"));
if (typeof cjs.Logger !== "function") {
  throw new Error("CJS root export is missing Logger");
}
const factory = await import(pathToFileURL(path.join(root, "dist/factory.js")).href);
if (typeof factory.createLogger !== "function") {
  throw new Error("factory entrypoint is missing createLogger");
}

console.log(
  `verify:exports ok — ${targets} files across ${Object.keys(pkg.exports).length - 1} entrypoints`,
);
