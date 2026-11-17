# BUG-0200 — „Mehr“-Menüpunkte liegen hinter der Steuerung und sind nicht trafbar

- **Status:** done (Stapelreihenicht Portal — gemessen)
- **Schicht:** pwa (EPIC-P63 Design-System, Auslösen von Ansichten in eigene Fenster)
- **Schwere:** S2 — vier inventarisierte Funktionen sind in diesem Modus nicht mehr
  erreichbar; am Hauptfenster funktioniert dasselbe weiterhin

## Beobachtung

Nach dem Fix der Leerzustands-Selektoren (BUG-0197) bleibt im Funktionsinventar genau
**eine** Gruppe rot: 10 passed / 1 failed. Die vier gemeldeten Wege liegen alle in einer
**herausgelösten Ansicht** (Popout-Fenster, `.tile[data-tile="1"]`):

```
S10 Mehr: Umgebung        waiting for locator('.tile[data-tile="1"]')
                            .getByRole('menu', { name: 'Weitere Ansichten' })
                            .getByRole('menuitem', { name: 'Umgebung', exact: true })
S33 Browser-Arbeitsplatz (Mehr)   dito (Menüpunkt „Browser“)
S65 Android-Testgeräte (Mehr)     dito (Menüpunkt „Geräte“)
S66 Android-Testgeräte in eigenes Fenster  dito
```

Der Klick auf den „Mehr“-Knopf im ausgelösten Fenster bringt also **kein** Menü
`Weitere Ansichten`. Derselbe Klick im Haupt-Sitzungsfenster funktioniert (dort öffnet das
Menü mit den Punkten Verlauf, Bericht, Datei, Graph, Git, GitLab, Suche, Umgebung, Browser,
Geräte — gemessen mit einer Wegwerfsonde bei 390, 834 und 1280 px Breite).

## Erwartet

`Mehr` ist in jeder Ansicht verfügbar, auch in einem eigenen Fenster (EPIC-P43 T43.7:
„jede Ansicht lässt sich am PC herauslösen“). Die Inventarwege S10/S33/S65/S66 laufen über
genau dieses Menü.

## Ursache (gemessen, nicht geraten)

Das Menü **öffnet** sich, der Menüpunkt wird gefunden, ist sichtbar und stabil — nur die
Zeigerereignisse fängt etwas anderes ab. Aus dem Playwright-Call-Log:

```
S10  … <button class="dock-toggle" aria-expanded="true">▾</button> from <div class="dock-stack">
        subtree intercepts pointer events
S33  … <div class="draft-state dim saved">Entwurf gespeichert …</div>        intercepts
S65  … <div class="reply-templates">…</div>                                   intercepts
S66  … element is not stable (der Dock-Höhenänderndes Menüs verschiebt den Punkt)
```

**Stapelreihenfolge, kein Portal:** der Kachelkopf `.session-topbar` steht auf
`--z-sticky` (10), die Steuerung `.dock-stack` auf `--z-dock` (20). Der Kopf bildet einen
Stapelkontext — was darin an Menüs hängt (bis `--z-overlay` 50), kann nicht über die
Steuerung hinaus. Der bestehende Versuch `.tile-tabs:has(.subtabs-more) { z-index: 20 }`
bleibt innerhalb dieses Kontexts und wirkt deshalb nicht. Die Titel-Vermutung dieser Akte
(„Portal außerhalb der Kachel / gar kein Menü im Fenster“) war **falsch**.

## Behoben

In `40-turns.css`: der Kopf erhält `--z-sheet` (60), **solange** dort ein Menü offen ist
(`.session-topbar:has(.subtabs-more)`, zusätzlich `:has(.session-menu[open])` für das
„⋯“-Menü desselben Musters). Geschlossen bleibt der Kopf bei 10, die Steuerung bleibt
also im Normalzustand oben — geändert wird nur der geöffnete Zustand.

| Messung | Ergebnis |
|---|---|
| `funktionsinventar.spec.ts --grep "erreichbar"` vorher | **1 failed** (S10/S33/S65/S66) |
| nach dem Fix | **9 passed** (1,5 min) |
| `pause-queue.spec.ts` (Dock-Wache) | **12 passed** |
## Nachweis

`npx playwright test e2e/specs/funktionsinventar.spec.ts --workers=1` → 10 passed / 1 failed
(Protokoll `data/tmp-debug/inv-fixed.log`, Zeilen 171–194). Vor dem Leerzustands-Fix waren
6 failed / 5 passed — die anderen fünf Wege sind mit BUG-0197 behoben.

## Nummer

**0200** (0197 = Leerzustands-Selektoren, 0198 = CRLF-Falschalarm, 0199 = Sprach-FAB).
