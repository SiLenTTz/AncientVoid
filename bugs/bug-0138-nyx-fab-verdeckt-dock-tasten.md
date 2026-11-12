---
id: BUG-0138
slug: nyx-fab-verdeckt-dock-tasten
status: done
severity: S2
area: pwa
instance: dev
commit: "901fd53"
forge: ""
epic: "EPIC-P43"
created: 2026-11-12
reporter: "Claude — volle E2E-Suite auf main"
---

# BUG-0138 — Voice-FAB liegt in der Standardposition auf den Dock-Tasten

## Gesehen

Am Handy fängt der Nyx-FAB den Klick auf „Beobachtung beenden“ ab (`harness.spec.ts` T7.5: „nyx-fab intercepts pointer events“, 45-s-Timeout).

## Erwartet

Ohne eigene Platzierung sitzt der FAB über dem Dock, nie auf dessen Tasten — egal wie hoch der Dock gerade ist.

## Repro

1. 390 × 800, Beobachter-Session (`claude-clip`) öffnen, FAB nie verschoben.
2. „Beobachtung beenden“ klicken.

**Ergebnis:** Der Klick landet auf dem FAB. Mit 56 px (vor BUG-0137) ging es knapp gut, mit 64 px nicht mehr.

**Häufigkeit:** immer.

## Eingrenzung

`apps/pwa/src/features/stt/fab-position.ts` `defaultFabPos`: feste Dock-Schätzung `88` px; der Dock wächst aber mit Steuerzeilen (Beobachter-Hinweis, Aktionen).

## Fix

Standardposition misst die Oberkante von `.dock-stack` (nur ein Dock unten über die Breite) und folgt ihr per `ResizeObserver`, Seitenwechsel und Fenstergröße — solange der Nutzer den FAB nicht selbst platziert hat.

## Tests

| Ring | Datei | vor dem Fix |
|---|---|---|
| Unit | `apps/pwa/test/features/stt/fab-position.test.ts` (über gemessener Dock-Oberkante) | — (neu) |
| E2E | `e2e/specs/harness.spec.ts` T7.5 | rot |
| E2E | `e2e/specs/nyx-fab.spec.ts` (FAB-Unterkante ≤ Dock-Oberkante) | neu |
