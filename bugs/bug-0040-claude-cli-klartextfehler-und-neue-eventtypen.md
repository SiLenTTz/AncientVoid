---
id: BUG-0040
slug: claude-cli-klartextfehler-und-neue-eventtypen
status: done
severity: S2
area: adapters
instance: prod
commit: ""
forge: ""
epic: "P7"
created: 2026-10-08
reporter: jan
---

# BUG-0040 — Claude-CLI: Klartext-Fehler und neue Event-Typen erscheinen kryptisch

## Gesehen

Beim Resume einer Session mit offener (verwaister) Tool-Freigabe schreibt die
Claude-CLI `Error: No deferred tool marker found in the resumed session…` als
Klartext statt als stream-json. Der Adapter zeigte nur „claude: non-JSON stdout
line"; der Nutzer sah weder Ursache noch nächsten Schritt. Neuere CLI-Versionen
(≥ 2.1.28x) liefern außerdem Top-Level-Events `attachment` und `stream_event`,
die als „unbekannter Typ" durchfielen.

## Erwartet

Klartext-Zeilen mit `Error:` werden als lesbares `system`-Event gemeldet; der
Resume-Fall nennt den Ausweg (neue Nachricht senden oder Session neu starten).
`attachment`/`stream_event` sind eigene, benannte Informationsevents. Nichts
wird still verworfen (AGENTS.md Regel 6).

## Repro

Voraussetzung: Adapter `claude`, Test mit `makeRecordingContext`.

1. Worker-stdout `Error: No deferred tool marker found in the resumed session\n`.
2. Events ansehen.

**Ergebnis nach Schritt 2:** nur „claude: non-JSON stdout line".

**Häufigkeit:** immer (bei dieser CLI-Fehlerlage)

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | Produktiv-Hub |
| Commit | `c72fde7` + lokale Änderung |
| Adapter | claude |
| Repro-Weg | adapter.test.ts (Fake-Worker) |

## Logs

```text
claude: non-JSON stdout line  { line: "Error: No deferred tool marker found …" }
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `packages/adapters/claude/test/normalize.test.ts` (attachment, stream_event) | rot ohne Fix |
| Adapter | `packages/adapters/claude/test/adapter.test.ts` (Error:-Klartext, 2 Fälle) | rot ohne Fix |

## Eingrenzung

`packages/adapters/claude/src/index.ts` (JSON-Parse-Fallback) und
`packages/adapters/claude/src/normalize.ts` (Switch auf `line.type`).

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue angelegt (derzeit nicht nötig, MR ist der Log)
- [x] Fix in derselben MR
