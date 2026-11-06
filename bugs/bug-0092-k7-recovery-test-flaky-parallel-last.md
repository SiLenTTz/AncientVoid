---
id: BUG-0092
slug: k7-recovery-test-flaky-parallel-last
status: done
severity: S3
area: core
instance: ci
commit: "558beb6e"
epic: "P28 T28.3 (Nachtrag fix 2026-11-06)"
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

1. CI-Job verify 17784044060 (Pipeline 3034048360, erster Lauf auf dem
   Projekt-Runner) — parallel dazu `scripts/ci-repro.sh`-Kaltlauf #2 im Docker.
2. Derselbe Kaltlauf #2 (Log `/tmp/opencode/ci-repro-cold2.log`) — dasselbe
   Bild, gegenläufig.

In sequentiellen Läufen durchgehend grün (viele Läufe am 05./06.11.).

## Erwartet

Nach der Recovery einer beendeten Session kommen nur System-/Audit-Events;
es startet kein neuer Adapter-Lauf.

## Repro

Integrationstest „BUG-0092: nach Recovery läuft für beendete Züge keine
Generation mehr“ (`session-manager.test.ts`): drei Sessions mit
`autoStopAfterEvents`, harten Cut, `recoverAll()`, festes 300-ms-Fenster bei
100 Events/s — ohne Fix deterministisch rot (die neugestartete Generation
mit 10-ms-Intervall emittiert sicher hinein), mit Fix grün.

## Ursache (root cause, zwei Teile)

1. `packages/adapters/dummy/src/index.ts` — der dummy-Adapter meldete das
   Zug-Ende beim Auto-Stop nie über `ctx.turn("idle")` (ADR-0013); der
   persistierte Status blieb „working“, obwohl der Zug beendet war.
2. `packages/core/src/modules/sessions/session-manager.ts` (`recoverOne`) —
   die K7-Recovery rief `adapter.recover()` auch für beendete Züge (Status
   „working“ lt. Record) auf, und der dummy startete dort bedingungslos
   eine **neue** Generation (`running: true`). Deren Events landeten unter
   Last vor der Assert-Auswertung im Journal — der Flake. Tiefer: Eine
   beendete Session hätte nach echtem Hub-Restart einfach weiterlaufen
   (Kosten, Doppelarbeit).

Der Parallellast war nur der Vergrößerer; das Fenster existierte immer.

## Fix (ADR-0050)

- dummy: `ctx.turn?.("idle")` beim Auto-Stop — der persistierte Status wird
  wahr (wie bei echten Adaptern).
- `SessionRecord.persistentWorker` (Contract, additiv, default false;
  DB-Migration 26 `persistent_worker`): persistenter Adapter-Prozess
  überlebt den Crash im Record.
- `recoverOne`: `adapter.recover()` nur noch für offene Züge
  (working/starting/waiting_approval) oder `persistentWorker`-Sessions
  (ACP-Adoption bleibt geschützt). idle/parked ohne persistenten Prozess
  werden wiederhergestellt und steuerbar gemeldet; ein neuer Prompt läuft
  über den normalen steer/reopen-Pfad (mit Skill-Kette, `continueStopped`).

Keine Assertion des K7-Tests geändert; die Betriebsdoktrin „keine schweren
lokalen Läufe parallel zum Runner“ bleibt als Ressourcenschutz bestehen.

## Nachweis

Rot-dann-grün (neuer Integrationstest), alle 41 Tests der Datei grün,
Recovery-/Steer-/Interrupt-Suiten (36 Tests) grün, core gesamt 367 grün,
typecheck/lint grün; E2E- und Pipeline-Nachweis im MR.
