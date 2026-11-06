---
id: BUG-0097
slug: sessionseite-scrollt-bei-ui-zoom
status: done
severity: S2
area: pwa
instance: live (Nutzerbericht 06.11.2026)
commit: "3d751071"
epic: ""
created: 2026-11-06
reporter: "Nutzer"
---

# BUG-0097 — Session-Hauptseite scrollt; Chat ragt unter den Dock (UI-Zoom)

## Gesehen (Nutzerbericht 06.11.2026)

„Die Session Hauptseite hat eine Scrollbar! Nur der Trajectory/Chat sollte
das haben, nicht die gesamte Seite. Außerdem sind die Buttons ab und zu
überdeckt — diese sollten immer gut sichtbar und nicht abgeschnitten sein."

Messung (Playwright, Mobile-Projekt, `ancientvoid.uiScale=1.3`): Tail-Unterkante
637 px bei Dock-Oberkante 527 px — der Chat läuft 110 px **unter** den
fixierten Dock; die letzten Zeilen/Buttons sind verdeckt. Mit genug Inhalt
über dem Tail wächst die Seite über das Viewport hinaus → Seiten-Scrollbar.

## Erwartet

Nur der Chat/Verlauf (`.tail-scroll`) scrollt; die Sessionseite selbst
passt ins Viewport, und die Chat-Unterkante bleibt über dem Dock — auch mit
UI-Zoom ≠ 100 %.

## Repro

E2E `session-scroll.spec.ts` (mobile, mit `uiScale=1.3` vor dem App-Boot):
`scrollingElement.scrollHeight <= clientHeight+1` und
`tail.bottom <= dock.top+1`. Ohne Fix rot (Tail-Unterkante liegt unter der
Dock-Oberkante), mit Fix grün.

## Ursache

`SessionTail.tsx` misst den verfügbaren Platz mit
`getBoundingClientRect()`/`window.innerHeight` — unter `html { zoom }`
(EPIC-P20 T20.2, `ui-scale.ts`) sind das **visuelle** Pixel. Der Wert wird
aber als `max-height: Npx` (Layout-Pixel) gesetzt und dadurch beim Rendern
noch einmal mit dem Zoom multipliziert: Der Chat wird um den Zoomfaktor zu
hoch, läuft unter den Fixed-Dock und schiebt die Seite über das Viewport.
Die Messung nutzt zudem viewport-relative Koordinaten (scroll-abhängig).

## Fix

`max-height: calc(Npx / var(--ui-zoom, 1))` — die Messung bleibt visuell,
die Höhe wird in Layout-Pixeln gesetzt. Zusätzlich misst die Funktion mit
Dokument-Koordinaten (`rect + scrollY`), damit ein einmal gescrollter
Zustand die Höhe nicht einfriert.

## Nachweis

Siehe MR.
