---
id: BUG-0148
slug: automations-tick-waechst
status: done
severity: S2
area: core
instance: dev
commit: ""
forge: ""
epic: "EPIC-P41"
created: 2026-11-12
reporter: "Claude — K8-Messung für EPIC-P41 §8 Punkt 4"
---

# BUG-0148 — Automations-Tick wächst mit der Laufzeit und blockiert den Hub

## Gesehen

Messung mit 128 Plänen im Minutentakt (das Kontingent-Maximum), simulierte Uhr: Tickzeit 38 ms am Anfang, 249 ms nach sechs Stunden, linear weiter (rund 1 s nach einem Tag). Der Scheduler tickt jede Sekunde — nach einem Tag ist die Event-Loop des Hubs dauerhaft belegt (K8).

## Ursache

- `processTick` schreibt bei jedem Tick einen vollständigen Snapshot (eingerückt), auch ohne Änderung.
- Das Journal wird nie gekürzt; ein Neustart parst alle Zeilen.
- Abgeschlossene Claims bleiben unbegrenzt im Zustand.
- `claimsFor` und `inFlight` durchsuchen bei jedem Aufruf alle Claims aller Pläne.

## Fix

`AutomationStore` indiziert Claims je Automation, schreibt den Snapshot nur bei Änderung (kompakt), kürzt danach das Journal (das Replay überspringt `seq ≤ appliedSeq`, ein Absturz dazwischen ist harmlos) und behält je Automation die neuesten `CLAIM_HISTORY_KEEP = 200` abgeschlossenen Claims; offene (claimed/dispatched/unknown) bleiben immer. Der Verlauf ist damit auf 200 Einträge plus offene begrenzt (die PWA speichert ohnehin höchstens 100 offline).

## Tests

| Ring | Datei | vor dem Fix |
|---|---|---|
| Unit | `core/automations/k8.test.ts` — Verlauf begrenzt, offene bleiben, Journal leer, Neustart gleich | rot |
| Unit | `core/automations/k8.test.ts` — Snapshot nur bei Änderung | rot |
| Unit | `core/automations/k8.test.ts` — 128 Minutenpläne über 260 Minuten: Claims ≤ 201 je Plan, Journal leer, späte Ticks < 500 ms | rot |

Messung (128 Minutenpläne, simulierte Uhr, 6 Stunden): Tick nach 6 h 249 ms → 51 ms, Neustart 354 ms → 32 ms.
