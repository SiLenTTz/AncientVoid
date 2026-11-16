---
id: BUG-0165
slug: restart-session-working-ohne-worker
status: done
severity: S2
area: core
instance: dev
commit: "1e5b2312"
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/merge_requests/481"
epic: ADR-0074/ADR-0076, K7
created: 2026-11-15
fixed: 2026-11-16
reporter: "Jan (Nutzermeldung 15.11.2026, Session-Rest-Recherche)"
---

# BUG-0165 — Restart lässt Session dauerhaft `working` ohne Worker

## Gesehen

Nach einem Hub-Restart (Crash/Neustart) bleibt eine Session, deren Zug beim
Restart abgeschnitten wurde, dauerhaft auf `working` stehen — obwohl kein
Worker mehr läuft. In der PWA sieht sie für immer „läuft“, controllable: false;
weder Zugende noch Unterbrechung treten je ein.

## Erwartet

Recovery führt eine Session mit totem Worker in `interrupted` über
(`session.interrupted`, reason `hub_restart`) statt sie dauerhaft `working` zu
lassen — unabhängig davon, ob zum Crash-Zeitpunkt Aktivitäten offen waren.
Nur echt externe Arbeit (eigener Herzschlag, ADR-0074) hält die Session ehrlich
`working`, und nur solange kein Zug nachweisbar offen ist.

## Repro

1. Session mit einem Adapter starten, der eine Provider-Aktivität meldet
   (`ctx.activity`, z. B. Subagent/Tool-Arbeit) und im Zug bleibt.
2. Warten bis `session.activity_begin` im Journal steht, Status `working`.
3. Hub hart beenden (`db.close()` ohne Shutdown — K7-Realität) und neu starten
   (`recoverAll`).

**Ergebnis nach Schritt 3:** Status bleibt `working`, Event
`session.recovered` mit `controllable: false` und der toten Aktivität als
`openActivities`. Kein `session.interrupted`, kein `session.turn_end`.

**Häufigkeit:** immer (jede `working`-Session mit offener Provider-Aktivität
oder offener Aktivität bei nachweisbar offenem Zug beim Restart)

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (`127.0.0.1:7373`) |
| Commit | `538b77d0` |
| Adapter | beliebig (getroffen in Session-Rest-Recherche 15.11.2026) |
| Repro-Weg | Unit (K7-Neustart-Harness wie activity-register.test.ts) |

## Eingrenzung

`packages/core/src/modules/sessions/session-manager.ts:2389` — die
Aktivitäten-Branch der K7-Recovery (`if (session.activities.size > 0)`) kehrt
vor der Adoption-/Unterbrechungsprüfung (Zeile 2415) zurück. Sie war für
*externe* Jobs gebaut (BUG-0155/ADR-0074), erfasst aber auch:

- Provider-Aktivitäten — sie sterben mit dem Worker, niemand meldet je ihr
  Ende; `expire()` greift nur für `source === "external"`.
- nachweisbar offene Züge (`main_turn_start` ohne Ende, `mainTurnIdle === false`)
  mit externer Arbeit: Der Zug ist abgeschnitten, nur die externe Arbeit läuft
  weiter — der tote Zug wird nie als `interrupted` journalisiert.

Zudem verhindert die Branch die Worker-Adoption (`adapter.recover()` wird nie
aufgerufen), überlebende tmux-/persistente Worker würden also auch nicht
wiederangehängt.

## Tests

| Ring | Befund / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `packages/core/test/modules/sessions/activity-register.test.ts` (2 neue Fälle + BUG-0155-Fall geschärft) | rot (`working` statt `interrupted`) |

## Fix und gezielte Gegenprobe

Die Aktivitäten-Branch der K7-Recovery kehrt nur noch zurück, wenn **jede**
offene Aktivität extern ist (`source === "external"`, eigener Herzschlag,
ADR-0074) **und** kein Zug nachweisbar offen ist (`mainTurnIdle !== false`).
Provider-Aktivitäten und abgeschnittene Züge fallen an die bestehende
Adoption/Unterbrechung: `adapter.recover()` bekommt überlebende Worker
wiederangehängt (tmux/persistent), tote Worker werden über
`interrupt("hub_restart")` ehrlich `interrupted`. Nach der Unterbrechung werden
die Provider-Einträge mit `session.activity_end` (code 1) geschlossen — ihr Ende
kann niemand mehr melden, ein offener Eintrag würde nach jeder Wiederaufnahme
das Laufende blockieren (`closeIfLast` sieht `activities.size > 0`). Externe
Einträge überleben bewusst und blockieren die Auto-Wiederaufnahme (ADR-0076:
kein zweiter Auftrag neben unklarer externer Arbeit).

Beide neuen Fälle waren vor dem Fix rot (Status `working` statt `interrupted`),
danach grün. Der BUG-0155-Bestandsfall wurde auf seine eigentliche Situation
geschärft (Zug fertig, nur externe Arbeit hält `working`) und bleibt grün.
Volle lokale Gates grün: 2212 Unit-/Integrationstests bestanden (4 sichtbar
übersprungen), 695 E2Es bestanden (5 sichtbar übersprungen; 26,5 min), Lint,
Typecheck, Architektur und Kontext grün. Skips sind keine Passes.

Fix und Review: [MR !481](https://gitlab.com/SiLenT_Tz/AncientVoid/-/merge_requests/481).

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue (Migration zu GitHub-Export geplant — siehe BUG-0163/0164)
- [x] `bugfix`
