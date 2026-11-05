---
id: BUG-0093
slug: desktop-e2e-zweiter-auftrag-fertig-race
status: done
severity: S3
area: e2e
instance: ci
commit: "5d08b08f"
epic: "P28 T28.3"
created: 2026-11-05
reporter: "P28-Umsetzung"
---

# BUG-0093 — Desktop-E2E prüft zweiten Auftrag gegen altes „fertig“

## Gesehen

`e2e/specs/desktop.spec.ts` › „Ziel sehen, Text eintippen, Taste senden …“
(mobile) schlug im ersten Lauf auf dem neuen Projekt-Runner rot:
`Expected "npm test -- --run äöüzielgenau", Received "npm test -- --run äöü"`
(Job [17788341685](https://gitlab.com/SiLenT_Tz/AncientVoid/-/jobs/17788341685),
294 passed / 1 failed). Dasselbe Spec-Feld war schon BUG-0090-Umfeld.

## Erwartet

Nach dem zweiten Eintippen-Auftrag enthält `desk.typed` den vollständigen
kumulierten Text, sobald der Test prüft.

## Repro

Nur unter CI-Timing (2 Workers, 8-CPU-Limit) aufgetreten; lokal (4 Workers,
16 CPUs) durchgehend grün. Rot-Nachweis: obenstehender Job-Trace mit
Screenshot/Trace-Artefakt.

## Ursache

Der Test wartete nach dem zweiten Auftrag nur auf generisches „fertig“ in
`.desktop-action` — das stammt noch vom ersten Auftrag. Der Prüflauf liest
`desk.typed`, während der Companion den zweiten Auftrag erst tippt
(WebSocket-Rennen zwischen UI-Anzeige und Fake-Desktop-Puffer).

## Fix

Zusätzlich auf den auftragspezifischen Abschluss warten („9 Zeichen in foot
getippt“, gemeldet von `companion.ts` status done), bevor `desk.typed`
geprüft wird — analog zur „21 Zeichen“-Zeile des ersten Auftrags, die genau
deshalb stabil war. Kein Produktverhalten geändert; keine Assertions
entschärft.

## Nachweis

Rot: Job 17788341685 (alte Fassung). Grün: erneute Läufe derselben Spec in
CI und lokal nach Fix (siehe Epic-Abschluss P28).
