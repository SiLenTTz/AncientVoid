import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Third-party adapters import subpaths like "@ancientvoid/contracts/adapter";
// a moved file must not silently break that public entry (ADR-0020 did once).
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as { exports: Record<string, string> };

describe("@ancientvoid/contracts package exports", () => {
  for (const [entry, target] of Object.entries(pkg.exports)) {
    it(`${entry} points at an existing file and loads`, async () => {
      const file = resolve(root, target);
      expect(existsSync(file), `${entry} -> ${target}`).toBe(true);
      await expect(import(file)).resolves.toBeDefined();
    });
  }
});
