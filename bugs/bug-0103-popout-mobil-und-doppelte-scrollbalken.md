---
id: BUG-0103
slug: popout-mobil-und-doppelte-scrollbalken
status: done
severity: S3
area: pwa
instance: live
epic: "P34"
created: 2026-11-07
reporter: "Nutzer (PWA)"
---

# BUG-0103 — Eigenes Fenster in Handy-Breite, doppelte Scrollbalken links

## Gesehen

1. Eine Session im eigenen Fenster (Popout) erscheint am Desktop in der
   680-px-Handyspalte statt auf der ganzen Fläche.
2. In der Desktop-Aufteilung zeigt die linke Spalte zwei Scrollbalken
   (Spalte und Session-Liste), ebenso Werkzeug-Modals.

## Erwartet

Das Popout füllt das Fenster. Es gibt nie einen horizontalen Balken; in der
Übersicht scrollt nur die Session-Liste.

## Ursache

1. `#app { max-width: 680px }` (`02-layout.css`) — die Ausnahme galt nur für
   `:has(.split)`, nicht für `.popout-shell`.
2. `.split-list` (`overflow-y: auto`) umschloss `.dashboard` (ebenfalls
   `overflow-y: auto`); kein `overflow-x`-Schutz.

## Fix

`27-popout.css`: `#app:has(.popout-shell)` ohne Breitenlimit/Padding.
`02-layout.css`: `.split-list:has(.app-page > .dashboard)` scrollt nicht,
`overflow-x: hidden` auf Spalten, Dashboard und `.tool-pane`.

## Tests

CSS-only, per Browser-Spec abgedeckt in `e2e/specs/` (siehe MR).
