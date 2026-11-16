/**
 * Test-Tiers (gemessen am 2026-11-16, json-Reporter, ganzer Lauf).
 *
 * Grund für die Aufteilung: der Gesamtlief mass 959 s Testdauern in
 * maxWorkers:1 — ~18 Minuten Rückmeldung, damit als Entwicklungsschleife
 * unbrauchbar. Die Last ist stark konzentriert: sechs Dateien machen 84 %
 * aus (Adapter-Suiten, die echte CLI-Prozesse spawnen und auf Timeouts warten,
 * plus ein Lasttest).
 *
 *   Tier A  vitest.config.ts       → `npm test`, parallel, alles außer Tier B
 *   Tier B  vitest.slow.config.ts  → `npm run test:slow`, seriell (diese Liste)
 *
 * Tier B enthält alles ≥ 10 s gemessen sowie die Dateien mit
 * Wanduhr-Annahmen (BUG-0001/0002), die nicht parallel laufen dürfen.
 * Nichts verschwindet aus der Prüfung: `npm run gate` und die CI fahren beide
 * Tieres (eigene junit-Dateien). Verschiebt jemand eine Datei hierher, gehört
 * die gemessene Dauer in den Commit.
 *
 * Anzeigen: `npm run test:tiers`.
 */

/** Gemessen langsam: >= 10 s Datei-Dauer im Gesamtablauf. */
export const slow = [
  // Adapter-Suiten: spawnen echte Harness-CLIs; ohne installiertem CLI laufen
  // sie in Timeouts (deshalb auch die vielen Fehlschläge auf diesem Rechner).
  "packages/adapters/acp/test/adapter.test.ts", // 465 s, 33 von 42 fehlgeschlagen
  "packages/adapters/codex/test/app-server.test.ts", // 180 s, 13/16
  "packages/adapters/acp/test/contract.test.ts", // 15 s
  "packages/adapters/cursor/test/adapter.test.ts", // 12 s, 5/7
  // Lasttest-Charakter, kein Unit-Feedback:
  "packages/core/test/modules/automations/k8.test.ts", // 89 s für 3 Tests
  // Zeitbasierte Warte-Readiness:
  "packages/core/test/modules/devices/device-service.test.ts", // 38 s
  "apps/hub/test/modules/sessions/ws-history.test.ts", // 18 s
  "packages/core/test/modules/sessions/interrupted-session.integration.test.ts", // 12 s
  "packages/core/test/modules/workspace/workspace-services.test.ts", // 12 s, bindet Ports
];

/** Wanduhr-Annahmen: dürfen nie parallel zu anderen Dateien laufen. */
export const timingSensitive = [
  "packages/core/test/modules/sessions/session-manager.test.ts", // BUG-0001/0002
  "packages/core/test/modules/sessions/recovery-parallel.test.ts",
];

export const tierB = [...new Set([...slow, ...timingSensitive])];

const entry = process.argv[1] ?? "";
if (entry.endsWith("test-tiers.ts")) {
  console.log(`Tier B (${tierB.length} Dateien, seriell):`);
  for (const f of tierB) console.log("  " + f);
}
