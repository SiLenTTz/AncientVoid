# BUG-0200 — in ausgelösten Fenstern („eigene Fenster“) öffnet das „Mehr“-Menü nicht mehr

- **Status:** offen
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

## Ursache (Verdacht, zu prüfen)

Das Menü liegt seit EPIC-P63 in einem Baustein (`Sheet`), der bei ausgelösten Fenstern
**außerhalb** der Kachel gemountet wird (Portal unter `body`) oder gar nicht, weil das
Fenster-Layout (`.tile`) kein `subtabs-wrap` mehr besitzt. Der Spec-Locator ist auf die
Kachel beschränkt — wenn das Menü ein Portal ist, findet ihn die Spec nicht; wenn das Menü
im Fenster gar nicht existiert, ist die Funktion im Fenster weg. Beides wäre hier zu
unterscheiden und zu beheben (Portal-Ablage in die Kachel, oder Spec auf das Fenster
ausweiten — aber nur, wenn das Menü wirklich öffnet).

## Nachweis

`npx playwright test e2e/specs/funktionsinventar.spec.ts --workers=1` → 10 passed / 1 failed
(Protokoll `data/tmp-debug/inv-fixed.log`, Zeilen 171–194). Vor dem Leerzustands-Fix waren
6 failed / 5 passed — die anderen fünf Wege sind mit BUG-0197 behoben.

## Nummer

**0200** (0197 = Leerzustands-Selektoren, 0198 = CRLF-Falschalarm, 0199 = Sprach-FAB).
