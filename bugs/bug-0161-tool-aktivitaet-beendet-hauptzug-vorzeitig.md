---
id: BUG-0161
slug: tool-aktivitaet-beendet-hauptzug-vorzeitig
status: done
severity: S1
area: core
instance: dev
commit: ""
forge: ""
epic: ADR-0076 (BUG-0155-Nachtrag), PRD K1/K2
created: 2026-11-14
fixed: 2026-11-14
reporter: "Jan (Nutzermeldung 14.11.2026)"
---

# BUG-0161 — Tool-Aktivitätsende beendet den Hauptzug vorzeitig (Notification-Flut, „bereit“ statt „aktiv“)

## Gesehen

Live-Hub (Session `f1de9b73…`, opencode, Aufgabe „Nächstes Epic im Backlog
ermitteln“): `notifications`-Tabelle zeigt „Zug fertig“ im Sekundentakt
(IDs 1604–1628, 08:40–08:44), während der Agent ununterbrochen arbeitet;
die Übersichtskarte zeigt zwischen den Tool-Runden „bereit“. Nutzerbericht:
„nach jedem erfolgreichen Tool-Call eine Notification … alle paar Sekunden
bei jeder Nachricht“ und „Session zeigt bereit statt aktiv während sie
arbeitet“.

Event-Muster (`data/sessions/f1de9b73…/events.jsonl`): pro Tool-Runde
`session.activity_begin` (Quelle `provider`, `tool:call_…`) →
`session.activity_end` → **`session.turn_end`** — ohne dass ein neuer
`session.main_turn_start` folgt. 28 turn_end bei 1 logischer Aufgabe.

## Erwartet

Der Hauptzug endet erst, wenn der Agent wirklich fertig ist: Ein
Aktivitätsende (Tool, Job) settle-t die Session nur, wenn der Hauptzug
bereits beendet ist (`session.mainTurnIdle === true`, ADR-0076-Feld).
Status bleibt „working“, keine turn_end-Notification pro Tool-Runde.

## Eingrenzung

`packages/core/src/modules/sessions/session-activity.ts:61` —
`closeIfLast()` prüft nur `activities.size`, `activeWorkers` und Status,
nicht `session.mainTurnIdle`. Damit wird jedes letzte Tool-Ende eines
Agenten, der Tool-Aktivitäten meldet (opencode via ActivityReport), als
Zugende interpretiert: `settle` → Status idle + `session.turn_end` →
Notification „Zug fertig“ + Karte „bereit“. Eingeführt mit dem
BUG-0155/ADR-0074/76-Merge `a4135a6` (13.11.2026).

## Repro

Unit: `packages/core/test/modules/sessions/session-activity.test.ts` —
provider-Aktivität beenden, während `mainTurnIdle === false` → kein settle;
nach `main_turn_end` → settle. Live-Nachweis steht oben (DB + JSONL).
