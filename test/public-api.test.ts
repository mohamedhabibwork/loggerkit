import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** Guards the public API surface declared in package.json. */

const ROOT = path.resolve(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
  exports: Record<string, { import?: string; require?: string; types?: string }>;
  files: string[];
};

describe("public api", () => {
  it("every entrypoint has types, import, and require targets", () => {
    for (const [key, entry] of Object.entries(pkg.exports)) {
      if (key === "./package.json") {
        expect(entry).toBeDefined();
        continue;
      }
      expect(entry.types, `missing types for ${key}`).toBeTruthy();
      expect(entry.import, `missing import for ${key}`).toBeTruthy();
      expect(entry.require, `missing require for ${key}`).toBeTruthy();
    }
  });

  it("every import target points at a tsup entry that exists in src", () => {
    const tsup = readFileSync(path.join(ROOT, "tsup.config.ts"), "utf8");
    for (const entry of Object.values(pkg.exports)) {
      const target = entry.import;
      if (target === undefined) {
        continue;
      }
      const srcPath = target.replace("./dist/", "src/").replace(/\.js$/, ".ts");
      const src = readFileSync(path.join(ROOT, srcPath), "utf8");
      expect(src.length).toBeGreaterThan(0);
      expect(tsup).toContain(srcPath);
    }
  });

  it("ships only the intended files", () => {
    expect(pkg.files).toEqual(["dist", "README.md", "CHANGELOG.md", "LICENSE", "docs", "llms.txt"]);
  });

  it("every exports target exists in dist once built", () => {
    if (!existsSync(path.join(ROOT, "dist"))) {
      // `npm run check` runs tests before the build step; dist may not exist yet.
      return;
    }
    for (const [key, entry] of Object.entries(pkg.exports)) {
      if (key === "./package.json") {
        continue;
      }
      for (const field of ["types", "import", "require"] as const) {
        const target = entry[field];
        expect(target, `${key}: missing ${field}`).toBeTruthy();
        if (target === undefined) {
          continue;
        }
        expect(existsSync(path.join(ROOT, target)), `${key}: ${field} -> ${target}`).toBe(true);
      }
    }
  });
});
