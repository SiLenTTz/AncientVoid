# Zoom-robuste Flächen

Regel (Nutzer, 10.11.2026): **html/body und jedes eigene Fenster scrollen nie** —
nur Listen, Chatverlauf und Einzelkomponenten (Schubladen, Panels, Modals,
Composer) scrollen intern, und jede fensterfüllende Fläche füllt das Fenster
exakt (±1 px). Gilt bei jedem UI-Zoom (70–200 %, EPIC-P20) und jeder
Schriftgröße (85–130 %, EPIC-P34). Herkunft: EPIC-P50, BUG-0097/0098/0099/0102/0112/0113.

## Warum es kippt

`ui-scale.ts` setzt `html { zoom }` und spiegelt den Faktor in `--ui-zoom`.
Unter `zoom` sind `dvh`/`vh`/`vw` **Layout-Pixel** und werden beim Rendern mit
dem Zoom multipliziert: `85dvh` ist bei 130 % visuell 110 % des Fensters.
`getBoundingClientRect()` und `window.innerHeight` liefern dagegen visuelle
Pixel.

## Muster

1. **Fensterbezogene Maße teilen:** `calc(100dvh / var(--ui-zoom, 1))`,
   `calc(100vw / var(--ui-zoom, 1) - 16px)` — in Höhe, Breite und Offsets
   (`top`, `right`, …). Beispiele: `02-layout.css` (Shell), `27-popout.css`,
   `30-files.css` (Schublade, Browser-Panel).
2. **Regel R50:** ein ungeteiltes Maß **≤ 50 vh/vw** bleibt bei 200 %
   (`SCALE_MAX`) ≤ 100 % des Fensters und braucht keine Teilung. Größer, mit
   Fensterbezug → teilen. Nur ein Inhaltslimit in einem Container, der selbst
   im Fenster liegt und scrollt, darf größer bleiben (mit Begründung in der
   Audit-Tabelle).
3. **Harte Garantie:** Routen mit interner Scrollfläche setzen
   `html:has(<Shell>), html:has(<Shell>) body { overflow: hidden }`. Ein
   Messfehler wird so zu Clipping statt zu einem Seiten-Scrollbalken. Heute
   gesetzt für: Übersicht (`.app-page > .dashboard`), eigenes Fenster
   (`.popout-shell`, gilt für alle Fensterarten) und mobile Session-Hauptroute
   (`#app > .session-live`). Nicht auf Routen ohne interne Scrollfläche
   (Nebenseiten) setzen — dort wäre Inhalt sonst unerreichbar.
4. **JS misst in visuellen Pixeln:** Ergebnisse, die als CSS-Länge gesetzt
   werden, durch `--ui-zoom` teilen (`SessionTail.tsx`, BUG-0097).

## Pflicht für neue Flächen

Jede neue fensterfüllende oder fensterbegrenzte Fläche bekommt eine Zeile in
der Zoom-Matrix `e2e/specs/zoom-flaechen.spec.ts` (uiScale 70/100/130/200 ×
Schrift 85/100/130; Seite scrollt nie, Unterkante == Fensterhöhe ±1 px, am PC
== Oberkante der Statusleiste). Audit-Stand: `epics/EPIC-P50-zoom-robuste-flaechen.md` §3.4;
BUG-0122 (Overlay-Höhen) ist done — Matrix-Zeile in `zoom-flaechen.spec.ts`.

Neuen Scan fahren:

```bash
rg '[0-9.]+(dvh|vh|vw)\b' apps/pwa/src/app/styles --glob '*.css'
```
