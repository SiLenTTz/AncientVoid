# BUG-0180 — Ausgeklappter Z Fold verschenkt die Breite: 680-px-Spalte mitten im Screen

- **Status:** done
- **Schicht:** pwa
- **Schwere:** S2 — auf dem Zielgerät (Galaxy Z Fold 7, inneres Display ausgeklappt)
  unbenutzter schwarzer Rand links und rechts; die Sitzungsliste war ein quer
  scrollbarer Streifen

## Beobachtung (gemessen, nicht gefühlt)

Viewport des ausgeklappten Fold (Chrome, hoch): **832 × 1088 CSS-px**. Gemessen im
laufenden Hub (`getBoundingClientRect`, Screenshot `fold-vorher.png`):

| Größe | vorher |
| --- | --- |
| `#app` Breite | **680 px** von 832 → 152 px schwarzer Rand (18 %) |
| `#app` max-width | `680px` (obwohl `.tablet-split` im DOM war) |
| `.session-strip` | horizontal: Items bei x = 12, 218, 379, 585, 790, **996** (jenseits des Viewports), `max-height: 120px` |
| Glocke | klebte am Rand der 680-px-Spalte, nicht an der Fensterecke |

## Ursache

1. `41-tablet.css` machte den Zweispalter **nur bei `@media (orientation: landscape)`**
  breit (`#app:has(.tablet-split){max-width:none}`) — das innere Fold-Display ist aber
   **hoch** (832 × 1088). Also blieb die 680-px-Spalte aus `02-layout.css` stehen.
2. Die Portrait-Regel in `45-readable-content.css` (`.session-strip{max-height:120px}`)
   gewann gegen die Tablet-Regel allein durch die **Reihenfolge** (gleiche Spezifität) —
   die Liste war auf gut eine Karte Höhe gedeckelt und scrollte seitwärts.

## Fix

`apps/pwa/src/app/styles/41-tablet.css`:

- Zweispalter jetzt bei `(min-width: 760px), (orientation: landscape) and (min-width: 700px)`
  — hoch wie quer; unter 760 px bleibt die Liste wie bisher als Leiste oben.
- Spaltenbreite als `--strip-col: clamp(232px, 30vw, 320px)`; Dock-Versatz und
  Glocke beziehen sich darauf (kein hartes `240px` mehr).
- `.tablet-split .session-strip { … }` mit höherer Spezifität: senkrecht,
  `max-height: 100dvh`, eigene Scrollspur — die Portrait-Deckelung gewinnt nicht mehr.
- `.tablet-split .strip-item:not(.strip-new)` linksbündig (Liste scannen statt
  Zentrum raten); der „Neu“-Knopf bleibt zentriert.

## Beleg (lokal gefahren)

- Neuer Spec `e2e/specs/fold-wide.spec.ts` **2 grün** (5,0 s): bei 832 × 1088 zwei
  Grid-Spalten (erste ≥ 200 px), Liste **links** von der Session, `#app` ≥
  Viewport − 28 px, `document.scrollWidth ≤ innerWidth`, keine Bedienelemente über
  dem Rand, aktive Karte + „Neu“ erreichbar; bei 412 px bleibt es eine Spalte.
- Nach dem Bau gemessen: `#app` = **832 px**, `grid-template-columns: 249,6 px +
  546,4 px`, Items bei x = 12, y = 6/75/111/180/249/318 (5 Sessions + „Neu“).
- Screenshots bei 832 × 1088 angesehen: vorher schwarze Balken + quer scrollbare
  Liste, nachher Liste links/Sitzungskarten lesbar; daraus folgte die Linksbündigkeit
  und die breitere Spalte (Vorher-Breite 199 px war zu schmal für Sitzungs­namen).
- `e2e/specs/tablet-layout.spec.ts` angepasst (die Portrait-Erwartung „Liste oben“ ist
  durch diesen Fix überholt) und in `docs/funktionsinventar.md` P16 nachgezogen.
- Keine Rückfälle: `browser-workspace`, `erststart`, `deeplink` = identische
  Fehlermenge wie ohne diese Änderung (Provider/tmux-Stand-ins auf Windows, BUG‑0179).

## Was es nicht ist

Neben der Liste steht weiterhin **eine** Session. Zwei Sessions gleichzeitig in einem
Fenster ist nicht implementiert; vorhanden sind die „eigenen Fenster“ (EPIC-P34
T34.10, `features/windows/PopoutShell.tsx`, die mehrere `SessionTail` montieren) — die
öffnet Android als eigenes Fenster/Tab, nicht als geteilte Fläche in der App.
