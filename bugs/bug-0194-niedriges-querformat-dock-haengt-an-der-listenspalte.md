# BUG-0194 — niedriges Querformat: Dock hängt an der Listenspalte, Warteschlangen-Text unlesbar

- **Status:** done
- **Schicht:** pwa (Layout)
- **Schwere:** S2 — im Querformat (Galaxy Z Fold ausgeklappt, Querhalterung) war die
  Eingabe nicht erreichbar, und auf dem Handy (390 px) war der vorgemerkte Text nicht lesbar

## Beobachtung

Eigenreview per Screenshot (Playwright-Harness, 17.11.2026, zwei Größen):

- **915 × 412 (Querformat, geteilte Ansicht):** die Tab-Leiste klebte halbhoch an der
  Unterkante, vom Dock war nur der Klapp-Winkel `▴` zu sehen — **kein Eingabefeld**.
  Gemessen: `.dock-stack` 52 px hoch, `.dock-tabs` und `.composer` gar nicht im Viewport.
- **390 × 844 (Handy hoch, zwei vorgemerkt):** pro Zeile Text plus **fünf** Symbolknöpfe in
  einer Reihe; der vorgemerkte Text endete bei „vierte Anfrage …“ — rund 15 Zeichen, die
  Meldung war nicht mehr zu lesen.

## Erwartet

Im Querformat bleiben Tab-Leiste, Eingabe und die Aktionsknöpfe der Warteschlange im Fenster.
Auf dem Handy ist der vorgemerkte Text die Hauptsache und muss lesbar sein.

## Ursache

1. `41-tablet.css` rückt das Dock in der Zweispalten-Ansicht nach links
   (`.tablet-split .dock-stack { left: calc(var(--strip-col) + 24px); }`). Die kurzen Regeln
   aus `50-short-viewport.css` (BUG-0053) setzen es auf volle Breite zentriert — bei
   gleicher Spezifität gewinnt die Importreihenfolge, und im niedrigen Fenster blieb das
   Dock links eingerückt, während die Höhe nicht reichte: Tabs und Eingabe rutschten unter
   die Unterkante. Zusätzlich nahm die Sitzungsliste als Spalte bis zu `100dvh` Höhe ein.
2. `QueueList` setzte Text und fünf 44-px-Knöpfe in **eine** Flex-Zeile. Auf 390 px bleibt
   für den Text dann eine fünfzehn Zeichen breite Spur.

## Fix

- `50-short-viewport.css` (zuletzt importiert, gewinnt die Kaskade) für `max-height: 520px`:
  `.tablet-split .dock-stack { left: 0; right: 0; max-width: var(--chat-max-width);
  margin: 0 auto; }` — die Liste bleibt Spalte (BUG-0180), das Dock bleibt mittig. Dazu
  `.tablet-split .session-strip { max-height: calc(100dvh - 210px); }`.
- Warteschlangen-Zeile wird zweizeilig: `.queue-item` als Grid (`auto minmax(0,1fr)`),
  `.queue-actions` mit `grid-column: 1 / -1` unter dem Text; im niedrigen Fenster
  `.queue-actions .icon-action { min-height: 36px; }` und `.queue-list { max-height: 30dvh;
  overflow-y: auto; }`.

## Nachweis

- `e2e/specs/pause-queue.spec.ts` → „im Querformat bleibt die Zustellwahl neben der Eingabe
  erreichbar“ (915 × 412, Steuerei per `▴` aufgeklappt, Chip in Viewport, rechts keine
  Überstellung) und „↑ ↓ und ✎ wirken beim Hub, nicht nur in der Ansicht“.
- `e2e/specs/querformat.spec.ts` unverändert grün (die Spalte bleibt, 18 von 18 grün mit
  `pause-queue.spec.ts` zusammen, `--workers=1`).
- Screenshots im Eigenreview: 390 × 844 (Text voll lesbar, Knöpfe darunter), 915 × 412
  (fünf Aktionsknöpfe vollständig über dem Eingabefeld).

## Offen (nicht dieser Bug)

Der Sprach-Knopf (Nyx-FAB) steht im Querformat weiterhin über der rechten Kante des
Sitzungsinhalts; das ist der bekannte Konflikt aus BUG-0176/BUG-0053 und wird separat betrachtet.
