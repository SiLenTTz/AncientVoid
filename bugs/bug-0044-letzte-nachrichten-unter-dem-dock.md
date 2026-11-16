---
id: BUG-0044
slug: letzte-nachrichten-unter-dem-dock
status: done
severity: S2
area: pwa
instance: prod
commit: ""
forge: ""
epic: "P1.6"
created: 2026-10-08
reporter: jan
---

# BUG-0044 — Die letzten Nachrichten liegen unter dem fixierten Dock

## Gesehen

Im Sessions-Screen sind die letzten Nachrichten teilweise abgeschnitten. Gemessen
(Pixel 7): Direkt nach dem Öffnen ragt die Liste 28 px unter das Dock (letzte
Nachricht 22 px verdeckt); nach „Steuerung ausblenden“ → „einblenden“ liegt sie
204 px darunter.

## Erwartet

Die letzte Nachricht liegt immer vollständig über dem Dock, auch nach Ein- und
Ausblenden der Steuerung, wenn sich die Höhe darüber ändert, und beim Filterwechsel.

## Repro

1. Beendete Session mit vielen Events öffnen, „Verlauf“ → „Debuggen“.
2. Unten „Steuerung ausblenden“, dann „Steuerung einblenden“.

**Ergebnis nach Schritt 2:** letzte Nachricht ca. 200 px unter dem Dock.

**Häufigkeit:** immer nach Dock-Wechsel; beim Öffnen abhängig vom Timing.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | Produktiv-Hub, Handy-PWA |
| Commit | `a1ebc9d` |
| Repro-Weg | E2E (Playwright, Pixel 7) |

## Logs

```text
A offen: tailMax 389px, dockH 287, tailBottom 580, dockTop 552  (Liste 28 px unter dem Dock)
C wieder offen: tailAtBottom 218, lastHiddenByDock 204
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| E2E | `e2e/specs/session-scroll.spec.ts` „BUG-0044 …“ | rot ohne Fix |

## Eingrenzung

`SessionTail.tsx`: Die Höhe der Liste wird per JS aus `tail.getBoundingClientRect().top`
und der Dock-Höhe berechnet, aber nur bei Dock- und Fenster-Größenänderung neu
gemessen. Ändert sich die Oberkante (Laufleiste, Hinweise), bleibt der Wert
veraltet; nach der Höhenänderung wurde die Scrollposition nicht nachgezogen.
Fix: zusätzlich Elternelement und `visualViewport` beobachten, nach Höhenänderung
und Filterwechsel unten bleiben, wenn man unten war.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] Fix in derselben MR
