---
id: BUG-NNNN
slug: kurz-ascii
status: open
severity: S3
area: server
instance: dev
commit: ""
forge: ""   # GitHub-Issue- oder PR-URL
epic: ""
created: YYYY-MM-DD
reporter: ""
---

# BUG-NNNN — Kurztitel

## Gesehen

Was passiert, in einem Satz. Keine Vermutung über die Ursache.

## Erwartet

Was stattdessen passieren soll.

## Repro

Voraussetzung (Hub läuft? welcher Adapter? welche Session-Konfiguration?).
Dann nummerierte Schritte — über PWA (Browser) oder `hubctl` (CLI).

1. …
2. …
3. …

**Ergebnis nach Schritt N:** …

**Häufigkeit:** immer / manchmal / einmalig

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (`127.0.0.1:7373`) / Tailscale |
| Commit | `git rev-parse --short HEAD` |
| Node-Version | |
| Adapter | dummy / claude / codex / … |
| Repro-Weg | PWA / hubctl |

## Logs

Quelle und **Auszug** (keine Secrets, keine Tokens). Zeitstempel zur Aktion
zuordnen.

```text
(Auszug)
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | | nicht vorhanden / grün |
| Contract (`adapter-testkit`) | | |

Welcher Test **müsste** ohne Fix rot sein? Datei vorschlagen, nicht
schreiben — das ist `bugfix`.

## Eingrenzung

Package (`packages/<name>`), `file:line` wenn schon bekannt, sonst „offen".

## Handoff

- [ ] Datei im Index [`README.md`](README.md)
- [ ] GitHub-Issue angelegt (`gh issue create`, URL in `forge:`)
- [ ] `bugfix` oder offen lassen
