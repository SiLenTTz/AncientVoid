---
id: BUG-0104
slug: popout-lesespalte-rand
status: done
severity: S3
area: pwa
instance: live
epic: "P35"
created: 2026-11-07
reporter: "Nutzer (PWA, Meldung 07.11.2026)"
---

# BUG-0104 — Eigenes Fenster nutzt nicht die ganze Fläche: 1200-px-Lesespalte als Ränder

## Gesehen

Live am Desktop (07.11.2026, Nutzermeldung): Das ausgeklinkte Chat-/Session-
Fenster „nimmt nicht die ganze Fläche ein und hat Ränder" — auf einem breiten
Fenster bleiben links und rechts breite Streifen frei, der Inhalt läuft in
einer mittigen Spalte. BUG-0103 behob schon die 680-px-Handyspalte (`#app`),
nicht aber diese Ränder.

## Erwartet

Das eigene Fenster füllt die Fensterfläche vollständig; Umbruch statt Ränder,
kein horizontaler Scrollbalken.

## Repro

- CSS: `apps/pwa/src/app/styles/27-popout.css:37` —
  `.popout-tile { padding-inline: max(12px, calc((100% - 1200px) / 2)) }`
  zentriert den Kachelinhalt in einer 1200-px-Spalte (übernommen aus
  `.tile-grid.layout-1 > .tile`, `02-layout.css:228`). Ab ~1224 px Fenster-
  breite wachsen die Streifen mit.
- E2E: `e2e/specs/windows.spec.ts` prüft nur `#app`-Breite (BUG-0103), nicht
  die Kachel selbst.

## Ursache

Die Lesespalten-Padding-Regel der Arbeitsflächen-Kacheln wurde für das
Popout übernommen — dort ist sie aber kein Lesekomfort, sondern ein Rand:
das Fenster ist selbst schon die Fläche.

## Fix

`27-popout.css`: `.popout-tile` bekommt festes `padding-inline: 12px` statt
der übernommenen `max(12px, calc((100% - 1200px) / 2))`-Regel — das Fenster
ist selbst die Fläche, Umbruch übernimmt der Tail.

## Tests

`e2e/specs/windows.spec.ts` (erster Spec): misst am 1440-px-Fenster das
computed `padding-left` der `.popout-tile` (≤ 12) und `scrollWidth ≤
innerWidth`. Ohne Fix rot (120 px), mit Fix grün. EPIC-P35 T35.1.
