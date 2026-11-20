---
id: BUG-0234
slug: session-zurueck-pfeil-am-breiten-layout
status: open
severity: S4
area: pwa
instance: dev
commit: "40a5f239"
forge: ""
epic: ""
created: 2026-11-20
reporter: "Nutzer (Maki-Session)"
---

# BUG-0234 — Zurück-Pfeil neben dem Session-Titel am Tablet/PC überflüssig

## Gesehen

Neben dem Session-Titel steht auch am Tablet/PC der „← Zur Übersicht“-Pfeil,
obwohl dort die Session-Liste (Split bzw. Tablet-Strip ab 700 px) dauerhaft
sichtbar ist.

## Erwartung

Ab 700 px Breite bleibt der Pfeil weg (Liste ist der Weg zurück); am Handy
unter 700 px bleibt er, dort gibt es keine sichtbare Liste.

## Repro

1. PWA am PC/Tablet (≥ 700 px) öffnen, Session öffnen.
2. Topbar besichtigen: „←“ vor dem Titel.

**Ergebnis nach Schritt 2:** Pfeil vorhanden, obwohl Liste sichtbar ist.

**Häufigkeit:** immer

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (`127.0.0.1:7373`) |
| Commit | `40a5f239` |
| Node-Version | 22 |
| Adapter | beliebig |
| Repro-Weg | PWA |

## Logs

Keine.

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| E2E | diverse Specs klicken „Zur Übersicht“ auch im Desktop-Viewport | grün (nutzen den Pfeil) |

## Eingrenzung

`apps/pwa/src/features/session/SessionTail.tsx:1635` rendert den Button
unbedingt; `apps/pwa/src/app/styles/10-voice-and-dock.css:146` formatiert ihn
ohne Breiten-Media-Query. Listen-Sichtbarkeit ab 700 px:
`apps/pwa/src/app/main.tsx` (`TABLET`/`WIDE`).

## Handoff

- [ ] Datei im Index [`README.md`](README.md)
- [ ] GitHub-Issue angelegt (`gh issue create`, URL in `forge:`)
- [ ] `bugfix` oder offen lassen
