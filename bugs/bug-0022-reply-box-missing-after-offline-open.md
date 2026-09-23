---
id: BUG-0022
slug: reply-box-missing-after-offline-open
status: fixed
severity: S3
area: pwa
instance: dev
commit: "7148e20"
forge: ""
epic: "EPIC-P8 T8.2 (offline-tolerant), gefunden beim P5-E2E-Gate"
created: 2026-09-23
reporter: "Claude Opus 5.5 (E2E-Gate, steer.spec.ts)"
---

# BUG-0022 — Antwortfeld fehlt dauerhaft, wenn der Hub beim Öffnen kurz weg war

## Gesehen

Eine Session wird geöffnet, während der Hub nicht antwortet (Neustart,
Funkloch). Die Session-Ansicht zeigt nur „Stop“, kein Antwortfeld. Kommt
der Hub zurück, bleibt das Feld weg, bis die Seite neu geladen wird.

## Erwartet

Das Antwortfeld erscheint, sobald `GET /api/adapters` wieder antwortet.

## Repro

1. Session öffnen (`#/sessions/<id>`), direkt danach Hub stoppen.
2. Hub wieder starten, warten, bis der Verbindungspunkt grün ist.

**Ergebnis:** kein Antwortfeld. Erst ein Reload bringt es zurück.

**Häufigkeit:** immer, wenn der Adapter-Abruf beim Öffnen scheitert.

## Eingrenzung

`packages/pwa/src/SessionTail.tsx`: `hubApi.adapters()` läuft einmal beim
Mount. Im `catch` wird `steerSupported` auf `false` gesetzt und nie erneut
geprüft.

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| E2E | `e2e/specs/steer.spec.ts` „BUG-0022“ (Adapter-Abruf der Ansicht scheitert, dann wieder erreichbar) | rot | grün |

## Fix

Scheitert der Abruf, fragt die Ansicht alle 3 s erneut, bis er klappt.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue
- [x] `bugfix`
