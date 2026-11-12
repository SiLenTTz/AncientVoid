---
id: BUG-0123
slug: doppelte-scrollbalken-session-kachel
status: done
severity: S3
area: pwa
instance: dev (Desktop-PWA, Nutzerbefund 11.11.2026)
commit: "efaa952"
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/merge_requests/393"
epic: "P43"
created: 2026-11-11
reporter: "Nutzer"
fixed: 2026-11-12
---

# BUG-0123 — Zwei Scrollbalken rechts in der Session-Ansicht

## Gesehen

Im Datei-Tab einer Session stehen rechts zwei Scrollbalken übereinander; man muss doppelt scrollen.

## Erwartet

Das Hauptfenster hat nie eine eigene Scrollbar; es scrollt genau ein Teilbereich (die Session-Liste).

## Eingrenzung

`.tile` und `.split-detail` hatten `overflow-y: auto`, zusätzlich scrollt `.tail-scroll` mit gemessener
`max-height` (`SessionTail.tsx`). Weicht die Messung um ein Pixel ab, scrollen beide.

## Fix

`02-layout.css`: `.tile:has(.tail-scroll)` und `.split-detail:has(.tail-scroll)` sind `overflow: hidden`
(MR !393). Dateiansicht scrollt nur horizontal im Code-Block.

## Tests

Kein eigener Scroll-Test (Playwright sieht keine Overflow-Balken zuverlässig); Layout-Specs
(`layout-desktop`, `kleinkram`) grün. Offen: ein Test, der `scrollHeight > clientHeight` an Kachel/Detailspalte
ausschließt.
