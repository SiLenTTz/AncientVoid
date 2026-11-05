---
id: BUG-0091
slug: steer-timeout-e2e-turn-race
status: done
severity: S3
area: e2e
instance: ci
commit: "0f0e63b82c1c5e61611b64ef08bf9c3fffdbae33"
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/41"
epic: "P27 DoD / P28 T28.1"
created: 2026-11-05
reporter: "Codex"
---

# BUG-0091 — Steer-Timeout-E2E wartet vor Folgeauftrag nicht auf Turn-Ende

## Gesehen

Der Timeout-Test erwartet HTTP 422, erhält im GitLab-Gate aber 200. Er wartete
nur auf die erste Assistant-Nachricht des vorherigen Zugs.

## Erwartet

Der vorherige Zug ist beendet, bevor gezielt der hängende `turn/start`
angesteuert wird. Timeout (3000 ms) und Idempotenz-Assertions bleiben unverändert.

## Repro

Playwright gegen echten Hub mit Codex-Testdouble:
[Job 17778072745](https://gitlab.com/SiLenT_Tz/AncientVoid/-/jobs/17778072745),
`pause-queue.spec.ts`, „eine hängende Antwort endet mit Timeout-Event“.
Lokal wird das Turn-Ende des ersten Zugs testseitig um 1000 ms hinter seine
Assistant-Nachricht verzögert (`SPAETES_ENDE` im CLI-Testdouble).

## Ursache

Zwischen Assistant-Nachricht und Turn-Ende ist noch ein Zug aktiv. Der
Folgeprompt erreicht dann den korrekten `turn/steer`-Pfad; der absichtlich
hängende `turn/start` wird gar nicht aufgerufen. Der Test muss vor dem
Folgeprompt auf den tatsächlichen Session-Status `idle` warten.

## Nachweise

Rot vor Fix mit verspätetem Turn-Ende: HTTP 200 statt erwartetem 422.
Danach dieselben Assertions mit Status-`idle`-Vorbedingung dreifach grün
(zusammen mit Desktop-/Scroll-Specs: 36/36). Voller Gate/MR folgen. Repro über
Playwright, keine produktiven Provider oder Roh-Logs.

Gemeinsamer Abschluss-Gate der getrennten CI-Blocker-Fixes: `npm run gate`
grün; 1152 Unit-/Integrationstests, 285 E2E-Pässe, zwei bestehende Mobile-
Handoff-Skips mit grünen Desktop-Gegenstücken. Keine Testlimits verändert.
Jeder Fix wird separat committet/gemerged; P27 erhält danach einen erneuten
vollständigen Gate des kombinierten Stands.
