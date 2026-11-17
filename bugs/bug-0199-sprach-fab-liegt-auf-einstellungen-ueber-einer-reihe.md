# BUG-0199 — der Sprach-FAB liegt auf der Einstellungen-Seite über einer Reihe und nimmt der Reihe das Bedienelement weg

- **Status:** offen
- **Schicht:** pwa (Speech-to-Text-FAB, `apps/pwa/src/features/stt/NyxFab.tsx`, global gemountet in `app/main.tsx:528`)
- **Schwere:** S2 — eine Einstellung ist an der Stelle **nicht erreichbar**; ein Tipp trifft
  den FAB statt den Schalter

## Beobachtung

Handy-Formfaktor 390 × 844, Einstellungen-Seite, gescrollt bis `y = 3200`: der FAB
(64 × 64 px, fix positioniert) liegt exakt über dem Schalter der Reihe **„Pinch-Zoom —
Feld-Zoom bleibt aus“**. Der Schalter ist im Screenshot gar nicht zu sehen; der FAB
verdeckt ihn vollständig
(`data/tmp-debug/live-fab-scroll3200.png`).

## Messung (nicht Augenschein)

`elementFromPoint(Mittelpunkt des Controls)` unter dem FAB, an mehreren Scrollpositionen:

```
FAB y=0      verdeckt=[]
FAB y=900    verdeckt=[]
FAB y=1800   verdeckt=[]
FAB y=2700   verdeckt=[]
FAB y=3200   verdeckt=[{ "trifft": "nyx-fab" }]      ← Pinch-Zoom-Schalter
FAB y=4200   verdeckt=[]
FAB y=5200   verdeckt=[]
```

Der Treffer ist das FAB-Element selbst, also geht der Tipp **nicht** an den Schalter.

## Erwartet

Kein Bedienelement liegt unter dem FAB. (Genau das hat BUG-0176 für die
Sitzungs-Ansicht schon geregelt: der FAB darf Aktionsknöpfe unten nicht überdecken.)

## Ursache

Der FAB ist global und fix; er weicht nur **vertikal** dem Dock aus
(`fab-position.ts`, BUG-0138: `bottomDock ? rect.top : undefined`). Auf langen,
scrollenden Seiten ohne Dock (`#/einstellungen`, `#/freigaben`, Übersicht) gibt es keine
Solids-Fläche, die er respektieren könnte — beim Scrollen wandert jede Reihe durch seine
Fixbox. Horizontal ausweichen ist bei 390 px Breite nicht möglich (kein Randspalt).

## Zwei Ausgänge (bewusst offen — es ist eine Produktentscheidung)

1. **Routenbereich:** der FAB erscheint nur dort, wo ein Diktat-Ziel existiert
   (Sitzungs-Ansicht/Composer). Auf `#/einstellungen`, `#/freigaben` und der Übersicht ist
   er weg — damit verschwindet die ganze Fehlerklasse. Preis: Diktieren in seltene
   Eingabefelder der Einstellungen (Einladungslabel, Endpoint-URL) entfällt.
2. **Ausweichhaltung:** der FAB räumt um, sobald ein Bedienelement unter seiner Box liegt
   (Trefferliste wie oben als Signal): er rutscht am Rand nach oben/unten oder blendet auf
   einen schmalen Randstreifen herunter, bis man ihn antippt. Aufwendiger, erhält die
   Funktion überall.

Bis zur Entscheidung ist der Workaround am Gerät: FAB per Zeigegestus an den oberen Rand
ziehen (er ist verschiebbar, `clampFabPos`).

## Nachweis / Reproduktion

Wegwerf-Spec über das E2E-Harness (390 × 844, `#/einstellungen`, Scrollpositionen 0…5200,
Treffer über `elementFromPoint`) — Ausgabe oben, Screenshot
`data/tmp-debug/live-fab-scroll3200.png`. (Spec wurde nach der Messung entfernt; die
Zahlen und das Bild sind der Beleg.)

## Nummer

**0199** (0196 = PR #93, 0197 = Inventar G19/S04, 0198 = CRLF-Falschalarm).
