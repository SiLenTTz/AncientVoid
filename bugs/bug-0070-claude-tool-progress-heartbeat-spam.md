---
id: BUG-0070
slug: claude-tool-progress-heartbeat-spam
status: done
severity: S3
area: adapters
instance: prod
commit: "43f43d0"
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/25"
epic: "P7"
created: 2026-10-27
reporter: hermes
---

# BUG-0070 — Claude-Heartbeats (`tool_progress`) füllen den Verlauf mit Meldungen „unhandled stream-json type“

## Gesehen

Bei lang laufenden Tools (z. B. Bash) schickt die Claude-CLI ab Version 2.1.3xx etwa alle 30 s ein
`tool_progress` mit `tool_use_id` + `-heartbeat-N`. Der Adapter kannte den Typ nicht und erzeugte
jedes Mal ein System-Event `claude: unhandled stream-json type "tool_progress"`.

## Erwartet

Ein bekannter, rein informativer Heartbeat eines schon gemeldeten Tool-Aufrufs erzeugt kein Event.
Unbekannte Typen bleiben sichtbar (Regel 6: fail loud).

## Repro

Voraussetzung: Produktiv-Hub, Adapter `claude`, CLI 2.1.310.

1. Eine Claude-Session mit einem lang laufenden Bash-Tool starten.
2. Den Event-Store der Session auszählen (`data/sessions/<id>/events.jsonl`).

**Ergebnis nach Schritt 2:** Session `85a88e06-…`: 257 solcher Events in 14 Stunden (60.625 Byte,
2026-10-08 22:21 bis 2026-10-09 12:19). Session `4b6aaa70-…`: 6 Events.

**Häufigkeit:** immer, solange ein Tool länger als ca. 30 s läuft.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | Produktiv-Hub |
| Commit | `43f43d0` |
| Adapter | claude (CLI 2.1.310) |
| Repro-Weg | Event-Store-Auswertung (kein PWA-Klickweg) |

## Logs

```text
system  summary: claude: unhandled stream-json type "tool_progress"   (257 ×, Session 85a88e06)
payload: { unhandledType: "tool_progress" }
```

Die Meldung „4,4 MB in einem hängenden Zug“ aus dem ursprünglichen Fund (Hermes, 27.10.) ließ sich in den
vorliegenden Sessions nicht nachvollziehen, gemessen sind 60 KB in der größten Session.

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `packages/adapters/claude/test/normalize.test.ts` | Fall „tool_progress … emits nothing“: ohne Fix rot (1 von 15), mit Fix grün (60/60 im Claude-Paket) |

## Eingrenzung

`packages/adapters/claude/src/normalize.ts`, `normalizeClaudeLine`: der Typ lief in den `default`-Zweig.
Fix: ein ausdrücklicher `case "tool_progress": return []` mit Begründung. Der `default`-Zweig meldet weiter
alles Unbekannte. Dass ein Tool noch läuft, zeigt weiterhin der Worker bzw. `updatedAt` der Session.

Herkunft: automatischer Fix eines externen Agenten (Hermes), irrtümlich direkt auf dem lokalen `main`
committet (`b24e659`, nicht gepusht). Hier mit Branch, Bug-Datei und MR nachgezogen.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitLab-Issue angelegt (Link oben)
- [x] `bugfix` erledigt, MR folgt
