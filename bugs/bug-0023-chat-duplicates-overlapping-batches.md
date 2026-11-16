---
id: BUG-0023
slug: chat-duplicates-overlapping-batches
status: done
severity: S2
area: pwa
instance: dev
commit: ""
forge: ""
epic: "EPIC-P5 (Handoff/Reconnect), gefunden beim E2E-Volllauf"
created: 2026-09-23
reporter: "Claude Opus 5.5 (E2E-Gate, workspace.spec.ts unter Last)"
---

# BUG-0023 — Chat zeigt Events doppelt nach Resync oder Replay

## Gesehen

Im E2E-Volllauf (4 parallele Worker) stand die Karte „Skills task → neon“
dreimal im Chat. Die API lieferte das Event einmal (seq 1).

## Erwartet

Jedes Event genau einmal, egal wie oft der Hub es schickt.

## Repro

Der Hub liefert mindestens einmal: `hello`-Replay und `resync` können sich
mit Live-Pushes überlappen (Resync bei `dropped` oder Lücke, unter Last
häufiger). Unit-Repro in `packages/pwa/test/ws-client.test.ts`: Chargen
`[1..4]`, `[3,4,5]`, `[2]` → ohne Fix kommen `[1,2,3,4,3,4,5,2]` an.

**Häufigkeit:** selten, lastabhängig.

## Eingrenzung

`packages/pwa/src/ws.ts`: `onmessage` reichte jede Charge ungefiltert an
`onEvents` weiter und setzte `lastSeq = highWater`.

## Fix

`newEvents(lastSeq, events)` in `ws-protocol.ts` verwirft alles mit
`seq ≤ lastSeq`; `lastSeq` folgt dem letzten wirklich neuen Event.

## Tests

| Ring | Datei | ohne Fix | mit Fix |
|---|---|---|---|
| Unit | `packages/pwa/test/ws-client.test.ts` | rot | grün |
| Unit | `packages/pwa/test/ws-protocol.test.ts` „newEvents“ | rot | grün |
| E2E | `e2e/specs/session.spec.ts` „genau einmal“ (Regressionsschutz) | grün | grün |

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue
- [x] `bugfix`
