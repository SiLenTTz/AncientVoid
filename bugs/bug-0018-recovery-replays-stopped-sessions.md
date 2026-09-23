---
id: BUG-0018
slug: recovery-replays-stopped-sessions
status: fixed
severity: S2
area: core
instance: dev
commit: ""
forge: ""
epic: "EPIC-P5 T5.6 / AC-P5-3 (K7)"
created: 2026-09-23
reporter: "Claude Opus 5.5 (P5-Statusanalyse)"
---

# BUG-0018 — Hub-Start liest den Verlauf jeder gestoppten Session ein

## Gesehen

Seit `92956d1` ruft `recoverAll()` für **jede** gestoppte Session
`store.replay()` auf und legt sie in `live`. Die Wiederherstellungszeit
wächst damit mit dem gesamten Verlauf abgeschlossener Läufe, nicht mit der
Zahl laufender Sessions. `sessionCounts().live` zählt alle gestoppten
Sessions mit.

Nebenbefund: Ist der Adapter einer gestoppten Session nicht registriert,
bekam die Session `adapter: null`. Ein Prompt endete dann in einem
TypeError und setzte die Session auf `error`.

## Erwartet

- K7 (< 3 s) hängt nur an Sessions, die bei Absturz liefen.
- Eine gestoppte Session wird geladen, wenn jemand sie öffnet (Tail-Abo
  aus der Übersicht) oder ihr schreibt. Das Nachlesen von Skill und
  Provider-ID passiert erst beim Weiterlaufen.
- Fehlt der Adapter: sichtbare Ablehnung, Status bleibt `stopped`.

## Repro

1. Session anlegen, stoppen, Hub beenden.
2. Neuen `SessionManager` auf derselben DB, `recoverAll()`.

**Ergebnis:** 1 Replay, `live` = 1.

**Häufigkeit:** immer.

## Eingrenzung

`packages/core/src/sessionmanager.ts`, `recoverAll()` (Zweig
`record.status === "stopped"`) und `stoppedShell()`.

## Fix

`openStopped()` ersetzt `stoppedShell()`: legt die Hülle ohne Replay an,
erst bei `subscribe()` oder `steer()`. `recoverAll()` zählt gestoppte
Sessions nur. Ohne registrierten Adapter liefert `steer()`
`adapter "<id>" not registered`.

## Tests

| Ring | Datei | ohne Fix | mit Fix |
|---|---|---|---|
| Unit | `packages/core/test/recovery-lazy.test.ts` „does not replay“ | rot (1 Replay) | grün |
| Unit | dito „open view sees the continued run“ | grün (Regression-Schutz) | grün |
| Unit | dito „adapter is gone“ | rot (TypeError-Detail) | grün |

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue
- [x] `bugfix`
