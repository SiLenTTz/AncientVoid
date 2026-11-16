---
id: BUG-0137
slug: nyx-fab-laesst-sich-nicht-ziehen
status: done
severity: S3
area: pwa
instance: dev
commit: "ce19ab6"
forge: ""
epic: "EPIC-P43"
created: 2026-11-12
reporter: "Jan (Nutzermeldung)"
---

# BUG-0137 — Der Voice-FAB lässt sich mit der Maus kaum verschieben

## Gesehen

Ziehen am Nyx-FAB bricht mit der Maus nach wenigen Pixeln ab; ohne verfügbare Spracherkennung lässt er sich gar nicht bewegen.

## Erwartet

Der FAB folgt dem Zeiger bis zum Loslassen, unabhängig davon, ob Spracherkennung verfügbar ist.

## Repro

1. PC-Breite (≥ 1280 px), Session öffnen.
2. FAB mit der Maus greifen und ziehen.

**Ergebnis:** Der Browser startet den nativen Bild-Drag des Nyx-Sprites (`<img>`), feuert `pointercancel`, der FAB bleibt stehen.

**Häufigkeit:** immer mit Maus; immer ohne Spracherkennung (`disabled`-Button bekommt keine Pointer-Events).

## Eingrenzung

- `apps/pwa/src/features/nyx/Nyx.tsx` `NyxSprite` rendert ein `<img>` im FAB — nativer Drag.
- `apps/pwa/src/features/stt/NyxFab.tsx` `disabled={…}` schluckt Pointer-Events.
- `resize` (Adressleiste/Tastatur am Handy) setzte die Position mitten im Ziehen zurück.

## Fix

`img` ohne Pointer-Events/Drag, `aria-disabled` statt `disabled` (Klick tut dann nichts, Ziehen geht),
`resize` während des Ziehens ignoriert. Zusätzlich 64 statt 56 px groß (Nutzerwunsch).

## Tests

| Ring | Datei | vor dem Fix |
|---|---|---|
| E2E | `e2e/specs/nyx-fab.spec.ts` (echte Maus zieht, ≥ 64 px, kein Aufnahme-Toast) | rot |
