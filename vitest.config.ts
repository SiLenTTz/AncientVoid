import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

// Slow-Test-Split (Laufzeit 2026-11-16): Der PR-Gate läuft nur den schnellen
// Kern (VITEST_SET=fast); Dateien über dem Schwellenwert stehen in
// scripts/slow-tests.json und laufen auf main und im Schedule-Lauf (nightly).
// Details: docs/ci-runbook.md.
const slowFiles: string[] = (JSON.parse(readFileSync(new URL("./scripts/slow-tests.json", import.meta.url), "utf8")) as { files: { file: string }[] }).files.map((f) => f.file);
const slowSet = process.env.VITEST_SET ?? "all";
const allGlobs = ["packages/*/test/**/*.test.ts", "packages/adapters/*/test/**/*.test.ts", "packages/loops/*/test/**/*.test.ts", "apps/*/test/**/*.test.{ts,tsx}", "scripts/**/*.test.mjs"];

export default defineConfig({
  test: {
    globalSetup: ["./scripts/vitest-global-setup.mjs"],
    include: slowSet === "slow" ? slowFiles : allGlobs,
    ...(slowSet === "fast" ? { exclude: ["**/node_modules/**", "**/dist/**", ...slowFiles] } : {}),
    // EPIC-P63 T63.7: Baustein-Tests sind TSX mit Preact-JSX.
    esbuild: { jsx: "automatic", jsxImportSource: "preact" },
    testTimeout: 15_000,
    hookTimeout: 15_000,
    pool: "forks",
    // Ersatz für poolOptions.forks.singleFork (seit vitest 4 entfernt): die
    // zeitbasierten Tests (BUG-0001/0002) laufen nacheinander, nicht parallel.
    maxWorkers: 1,
  },
});
