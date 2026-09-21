# ADR-0012 — Harness-Inventar und read-only Discovery-Scan

**Status:** akzeptiert · **Betrifft:** `packages/contracts/src/inventory.ts`,
`packages/contracts/src/adapter.ts`, `packages/contracts/src/identity.ts`,
`packages/core/src/inventory.ts`, `packages/core/src/sources.ts`, T5.1 und T5.3

## Kontext

ADR-0011 mischt Hub-Records mit injizierten `DiscoverySource`s, aber
`GET /api/discovery` übergibt keine Quellen. Audit §4 verlangt je Harness
eine belegte Version und eine ehrliche Discovery-/Resume-Zelle
(`verified` / `implemented-unverified` / `missing` / `blocked`).
Capability-Booleans sagen nicht, ob ein Adapter fremde Sessions nur liest
oder eine native Id fortsetzt.

## Entscheidung

1. **Inventar.** `HarnessCatalogEntry` hält die statische Zelle. Ein Probe
   startet das Binary ohne Shell, liest höchstens 512 Bytes und hängt
   `Probe: <version|binary missing|…>` an die Evidenz. Die Zelle selbst
   wird durch einen vorhandenen Binary nicht grün gefärbt.
2. **Capabilities.** `nativeDiscovery` ist `read-only | none`,
   `nativeResume` ist `native | none`. Nur Adapter, die wirklich scannen
   oder eine native Id wiederverwenden, behaupten mehr.
3. **Scan.** Claude-Code-Transcripts (`*.jsonl` plus
   `<session>/subagents/*.jsonl`) und Cursor-`composerHeaders` werden
   read-only gelesen. Subagent-Dateien setzen `parentSessionId`.
   Unbekanntes Top-Level-Format bleibt als `unsupported-format` sichtbar.
   Der Projektordner-Name von Claude ist kein rekonstruierter Pfad.
4. **Kein Schreiben.** Scanner öffnen SQLite mit `mode=ro` und parsen
   keine Transcript-Inhalte.

## Konsequenzen

- Resume-Zellen der CLIs bleiben `implemented-unverified`, bis AC-P5-2
  einen echten Handoff belegt.
- Codex, OpenCode, Copilot und Aider haben hier kein verifiziertes
  Dateilayout; dafür gibt es keinen Scanner.
