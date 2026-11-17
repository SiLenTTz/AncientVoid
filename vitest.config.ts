import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

// Slow-Test-Split (Laufzeit 2026-11-16): Der PR-Gate läuft nur den schnellen
// Kern (VITEST_SET=fast); Dateien über dem Schwellenwert stehen in
// scripts/slow-tests.json und laufen auf main und im Schedule-Lauf (nightly).
// Details: docs/ci-runbook.md.
const slowFiles: string[] = (JSON.parse(readFileSync(new URL("./scripts/slow-tests.json", import.meta.url), "utf8")) as { files: { file: string }[] }).files.map((f) => f.file);
const slowSet = process.env.VITEST_SET ?? "all";
const allGlobs = ["packages/*/test/**/*.test.ts", "packages/adapters/*/test/**/*.test.ts", "packages/loops/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts", "scripts/**/*.test.mjs"];

export default defineConfig({
  test: {
    globalSetup: ["./scripts/vitest-global-setup.mjs"],
    include: slowSet === "slow" ? slowFiles : allGlobs,
    ...(slowSet === "fast" ? { exclude: ["**/node_modules/**", "**/dist/**", ...slowFiles] } : {}),
    testTimeout: 15_000,
    hookTimeout: 15_000,
    pool: "forks",
    // Seriell war eine Noetzlichkeit (BUG-0001/0002: zeitbasierte Tests) — aber die
    // Wanduhr- und Port-Dateien stehen laengst in scripts/slow-tests.json und laufen als
    // Tier B weiterhin seriell (maxWorkers 1). Tier A, der PR-Gate, enthaelt keine davon:
    // der laeuft parallel. Gemessen 2026-11-17, 20 Kerne: Tier A seriell 451 s (mit dem
    // Attrappen-Fehler 246 s grau), parallel bei 8 Forks siehe PROGRESS/Akte BUG-0193.
    // VITEST_WORKERS verstellt die Stufe ohne Code-Aenderung.
    maxWorkers: slowSet === "slow" ? 1 : Number(process.env.VITEST_WORKERS ?? 8),
  },
});
