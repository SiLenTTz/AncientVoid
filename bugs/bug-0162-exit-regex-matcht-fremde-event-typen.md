---
id: BUG-0162
slug: exit-regex-matcht-fremde-event-typen
status: done
severity: S2
area: core
instance: dev
commit: ""
forge: ""
epic: ADR-0015
created: 2026-11-14
fixed: 2026-11-14
reporter: "Jan (Nutzermeldung 14.11.2026, Mitfund in BUG-0161-Recherche)"
---

# BUG-0162 — Exit-Regex der Notifications matcht thinking/assistant-Events („abgebrochen (Code 0)“ aus Agent-Text)

## Gesehen

Live-Hub: Notification 1609, 08:10:49.476 — „opencode abgebrochen (Code 0)“
(level error, kind `process.exit`), obwohl kein Adapter-Prozess fehlschlug.
Sekundengenau enthält das thinking-Event der Session diesen Text: Der Agent
dachte über den Regex `/process exited with code (\d+)/` selbst nach. In der
Session-JSONL matchen 12 Events den Regex — **alle** vom Typ `thinking`
bzw. Text-Inhalte, kein einziges echtes System-Exit-Event.

## Erwartet

„Prozess abgebrochen“-Notifications entstehen nur aus System-Events des
Adapters/Workers — nie aus Nachrichten- oder Denkinhalten des Agenten
(Prompt-Injektions-Grenze verwandt: Agent-Output ist Daten, nie Wahrheit
über Prozesse).

## Eingrenzung

`packages/core/src/modules/notifications/notifications.ts:88` — der
Fallback `const exited = /process exited with code (\d+)/.exec(event.summary)`
läuft für **jedes** Event, ohne `event.type` zu prüfen. Jeder Agent, der
über Prozesse schreibt (Debugging, Doku), feuert eigene Fehler-Notifications.

## Repro

Unit: `notificationFor` mit thinking-Event, summary enthält den String →
bislang Draft, erwartet null; system-Event bleibt Draft. Live-Nachweis
steht oben (DB 1609 ↔ JSONL thinking 08:10:49.476).
