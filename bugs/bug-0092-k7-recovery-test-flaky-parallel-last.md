---
id: BUG-0092
slug: k7-recovery-test-flaky-parallel-last
status: open
severity: S3
area: core
instance: ci
commit: "499a7cbffd8a01c1d0f4a53616bd5b3d981dc27e"
epic: "P28 T28.3"
created: 2026-11-05
reporter: "P28-Umsetzung"
---

# BUG-0092 — K7-Recovery-Test flaky unter paralleler Last auf demselben Host

## Gesehen

`packages/core/test/modules/sessions/session-manager.test.ts` › „K7 (AC-P0-1):
recovers 5 concurrent sessions, byte-identical, restore < 3s“ schlägt mit
`expected false to be true` fehl (Assertion: nach der Pre-Crash-Grenze dürfen
nur System-/Audit-Events folgen). Zweimal am 05.11.2026, jeweils **exakt dann,
wenn zwei volle Testumgebungen gleichzeitig auf demselben Host liefen**:

1. CI-Job verify 17788054060 (Pipeline 3034048360, erster Lauf auf dem
   Projekt-Runner) — parallel dazu `scripts/ci-repro.sh`-Kaltlauf #2 im Docker.
2. Derselbe Kaltlauf #2 (Log `/tmp/opencode/ci-repro-cold2.log`) — dasselbe
   Bild, gegenläufig.

## Erwartet

Der Recovery-Pfad hängt nicht davon ab, ob ein weiterer Prozess Last auf
demselben Host erzeugt; die Recovery-Anhängsel nach der Grenze sind
ausschließlich System-Events.

## Repro

Bisher nur unter Gleichzeitigkeit reproduzierbar: zwei vitest-Vollläufe
parallel (einmal Container mit 8-CPU/6-GiB-Limit, einmal Runner-Build). In
sequentiellen Läufen grün: lokaler Testsatz 1186 grün (05.11., zweimal),
einzelne Datei 40/40 grün, verify 17788164596 grün (Concurrency 1, keine
Parallelität). Keiner der Läufe lief mit reduzierten Assertions.

## Ursache

Ungeklärt. Vermutung: Timing-abhängige Interaktion zwischen Recovery
(gestartete Dummy-Generatoren mit `eventsPerSecond: 20`) und der
Grenzzählung `eventsBefore`, die unter CPU/IO-Konkurrenz ein non-system
Event nach der gezählten Grenze erscheinen lässt. Keine Analyse auf
Event-Ebene durchgeführt (P28-Scope: dokumentiert, nicht gefixt).

## Testlücke

Der Test behauptet Sequentialität über eine Zeitgrenze, ohne das
Nicht-Auftreten konkurrierender Generator-Events nach der Grenze zu
erzwingen — oder die Recovery darf unter Last legal andere Events anhängen;
beides ist bisher nicht unterschieden worden.

## Abgrenzung

CI-seitig entschärft durch ADR-0049-Betriebsregel (Runner-Concurrency 1,
schwere Läufe nicht parallel zum Runner — docs/ci-runbook.md). Der Defekt
bleibt offen für eine Kern-Analyse; kein Pass durch Retry oder entschärfte
Assertion.
