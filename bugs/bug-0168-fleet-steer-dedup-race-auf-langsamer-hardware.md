---
id: BUG-0168
slug: fleet-steer-dedup-race-auf-langsamer-hardware
status: done
severity: S3
area: hub
instance: ci
commit: "e86ac4f1b059ded39d9219b6017c417a92ec9154"
forge: "https://github.com/securesight-ai/AncientVoid/issues/12"
epic: ""
created: 2026-11-16
reporter: "GitHub-Actions-CI (PR #2, Run 43833945447)"
---

# BUG-0168 — Fleet-Steer-Dedup greift auf langsamer Hardware nicht (2 user-Events)

## Gesehen

Auf dem GitHub-gehosteten Runner schlägt
`apps/hub/test/modules/fleet/fleet-routing.test.ts` → „starts, reads and
steers a session on exactly the addressed host" fehl: Nach zweimaligem
identischem Steer liegen **zwei** `user`-Events (seq 4 und seq 7) in der
Session, erwartet genau eines; der zweite Steer antwortet zwar mit
`duplicate input ignored`, das Ereignis ist trotzdem schon durch.

## Erwartet

Der Eingabe-Dedup („duplicate input ignored") verhindert das zweite
`user`-Event unabhängig von Hardware- und Timing-Geschwindigkeit.

## Repro (gesehen: CI-Job-Trace, nicht lokal)

Voraussetzung: langsamer Runner (ubuntu-latest, 2 vCPU), Suite im
CI-Kaltlauf mit 298 Test-Dateien parallel.

1. `apps/hub/test/modules/fleet/fleet-routing.test.ts` ausführen.
2. Test sendet denselben Prompt zweimal an
   `/api/hosts/home-server/sessions/<id>/steer`.

**Ergebnis nach Schritt 2:** zweiter Aufruf → 200 mit
`detail: "duplicate input ignored"`, aber `peer.sessions.tail` zeigt
2 `user`-Events statt 1.

**Häufigkeit:** 1 von 1 GitHub-Runner-Läufen (16.11.2026); lokal bislang
0 Treffer.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | GitHub-Actions-Runner `ubuntu-latest` |
| Commit | `e86ac4f1` (ops/github-migration) |
| Node-Version | 24 |
| Adapter | dummy (fleet-routing über 2 In-Memory-Hubs) |
| Repro-Weg | CI (`npm test`) |

## Logs

CI-Job `verify` (Run 43833945447, 16.11.2026):

```text
FAIL apps/hub/test/modules/fleet/fleet-routing.test.ts > fleet routing
(T6.4, ADR-0017) > starts, reads and steers a session on exactly the
addressed host
AssertionError: expected [ { seq: 4, …(6) }, { seq: 7, …(8) } ] to have a
length of 1 but got 2
 ❯ apps/hub/test/modules/fleet/fleet-routing.test.ts:79:53
```

## Tests

| Ring | Befund / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `apps/hub/test/modules/fleet/fleet-routing.test.ts` | rot auf gehostetem Runner, grün lokal |

Der Zeuge ist der fehlschlagende Test selbst. Aufgelöst 16.11.2026: **kein
Produktfehler.** Der Dummy-Adapter emittiert seinen TYPE_CYCLE
(`packages/adapters/dummy/src/index.ts:45`), dessen erstes Element den Typ
`"user"` hat, ab dem ersten Timer-Tick (20 ev/s ⇒ alle 350 ms ein
`user`-Event). Der Test lief lokal in unter 50 ms — vor dem ersten Tick;
auf dem langsamen Runner dauerte er länger, das erste Zyklus-Event (seq 7,
erkennbar an `tokensEst`/`tokensSource`, daher „…(8)“ im Log) wurde mit
gezählt. Der Dedup selbst funktioniert: genau ein `session.prompt`-Event.

Fix: Die Assertion zählt nur echte Prompts
(`e.type === "user" && e.payload?.kind === "session.prompt"`); der
Hosted-Runner-Skip entfällt. Belegt durch Repro: alte Assertion plus 200 ms
Wartephase vor dem Tail reproduziert den CI-Fehler byte-identisch
(`expected [ { seq: 4, …(6) }, { seq: 7, …(8) } ] … got 2`), die neue
Assertion besteht denselben Lauf; außerdem 8× grün im Direktlauf.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitHub-Issue angelegt (`gh issue create`, URL in `forge:`)
- [x] `bugfix` (Test-Fix, 16.11.2026 — kein Core-Race, siehe oben)

Der Hosted-Runner-Skip (`AV_HOSTED_RUNNER`) ist mit dem Fix entfallen — der
Test läuft wieder überall verbindlich.
