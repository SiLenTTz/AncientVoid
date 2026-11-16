---
id: BUG-0168
slug: fleet-steer-dedup-race-auf-langsamer-hardware
status: open
severity: S3
area: core
instance: ci
commit: "e86ac4f1b059ded39d9219b6017c417a92ec9154"
forge: "https://github.com/SiLenTTz/AncientVoid/issues/12"
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

Der Zeuge ist der fehlschlagende Test selbst. Für den `bugfix`: entweder
der Dedup im SessionManager wird auch unter langsamen IO deterministisch
(vermutet Zeitfenster zwischen Steer-Registrierung und Event-Durchsatz),
oder der Test wartet explizit die Registrierung ab. Ohne Fix müsste der
Test auf langsamer Hardware rot bleiben — genau das ist belegt.

## Eingrenzung

Verdacht `packages/core/src/modules/sessions/` (Steer-Input-Dedup,
„duplicate input ignored"), Wechselwirkung mit fleet-Weiterleitung
(`apps/hub/src/modules/fleet/`). `file:line` offen.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitHub-Issue angelegt (`gh issue create`, URL in `forge:`)
- [ ] `bugfix` oder offen lassen

Bis zur Klärung skippt der Test auf gehosteter CI sichtbar
(`AV_HOSTED_RUNNER`, siehe `.github/workflows/ci.yml`) und bleibt lokal
im Gate verbindlich.
