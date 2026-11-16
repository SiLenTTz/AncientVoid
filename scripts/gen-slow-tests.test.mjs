import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { collect } from "./gen-slow-tests.mjs";

const list = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "slow-tests.json"), "utf8"));

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "slow-tests-"));
  const suites = files.map(([rel, seconds]) => {
    const path = join(root, rel);
    mkdirp(path);
    writeFileSync(path, "");
    return `<testsuite name="${rel}" tests="1" time="${seconds}"><testcase name="t" time="${seconds}"/></testsuite>`;
  });
  return { root, xml: `<testsuites>${suites.join("")}</testsuites>` };
}

function mkdirp(path) {
  mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
}

describe("gen-slow-tests (Laufzeit-Split 2026-11-16)", () => {
  it("nimmt nur Dateien über dem Schwellenwert auf, sortiert nach Dauer", () => {
    const f = fixture([
      ["packages/a/test/slow.test.ts", 30],
      ["packages/a/test/fast.test.ts", 2],
      ["packages/a/test/exact.test.ts", 10],
    ]);
    expect(collect(f.xml, f.root, 10)).toEqual([{ file: "packages/a/test/slow.test.ts", seconds: 30 }]);
  });

  it("ignoriert JUnit-Einträge für Dateien außerhalb des Repos", () => {
    const f = fixture([["packages/a/test/slow.test.ts", 30]]);
    const xml = `${f.xml}<testsuite name="/tmp/irgendwo/test/foreign.test.ts" tests="1" time="99"><testcase name="t" time="99"/></testsuite>`;
    expect(collect(xml, f.root, 10).map((e) => e.file)).toEqual(["packages/a/test/slow.test.ts"]);
  });

  it("kommittedes slow-tests.json: jede Datei existiert und ist eine Testdatei", () => {
    const root = join(import.meta.dirname, "..");
    for (const entry of list.files) {
      expect(existsSync(join(root, entry.file)), entry.file).toBe(true);
      expect(entry.file).toMatch(/\.test\.(ts|mjs)$/);
      expect(entry.seconds).toBeGreaterThan(list.thresholdSeconds);
    }
  });
});
