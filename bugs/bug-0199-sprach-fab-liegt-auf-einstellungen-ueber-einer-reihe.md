# BUG-0199 — der Sprach-FAB liegt auf der Einstellungen-Seite über einer Reihe und nimmt der Reihe das Bedienelement weg

- **Status:** done (Ausweichen der automatischen Platzierung; gezogene bleibt heil)
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

## Behoben (17.11., Regel + Messung)

**Regel:** die *automatisch* gewählte Platzierung weicht einem Bedienelement aus — der FAB
rückt eine Kantenlänge (64 px + 8 px Abstand) hoch oder runter, höchstens zwei Schritte;
findet er nirgends freien Platz, verschwindet er und kommt beim Weiterrollen wieder.
**Wer selbst gezogen hat, dem wird nichts weggeschoben** (`hasStoredFabPos`): gemerkte
Positionen bleiben unangetastet, sonst verteidigt die App ihren Platz gegen den Nutzer.

Neu: `apps/pwa/src/features/stt/fab-clearance.ts` (`placeFabAvoiding` — die Rechenregel ohne
DOM) und `fab-position.ts` (`hasStoredFabPos`). Die Prüfregel im Baustein ist **Geometrie**
(Mittelpunkt eines sichtbaren Controls innerhalb der FAB-Fläche), nicht der Trefferertest:
der Trefferertest misst immer gegen den *gerade rendernden* FAB und erklärt einen Kandidaten
für frei, der es nicht ist — zweiter Anlauf, gemessen bei Scroll 600 px als `SELECT ->
nyx-fab`. Die **Auswirkung** wird weiterhin per `elementFromPoint` gemessen (im Test), nur
die Kandidaten-Bewertung nicht.

Invariante „kein Bedienelement unter dem FAB“, über die ganze Einstellungsseite gemessen
(Scroll-Schritte zu 300 px, Trefferertest am Control-Mittelpunkt):

| Scrollpunkt | vor dem Fix | nach dem Fix |
|---|---|---|
| 3200 px | Pinch-Zoom-Schalter verdeckt (`INPUT -> nyx-fab`) | FAB bei y 639, frei |
| 600 px | — | FAB weicht, `SELECT` frei |
| alle Schritte 0 … ~6000 px | ein Treffer | **keine Treffer** |

Tests: `apps/pwa/test/features/stt/fab-clearance.test.ts` (5 Fälle: frei, hoch ausweichen,
runter ausweichen, alles belegt → `null`, Viewport-Grenze) und in `e2e/specs/nyx-fab.spec.ts`
der Fall „BUG-0199: auf langen Seiten ohne Dock verdeckt der FAB kein Bedienelement“.
Reihenfolge der Messung: `npx playwright test e2e/specs/nyx-fab.spec.ts --workers=1` zuerst
1 failed / 8 passed (Selektor bei 600 px, zudem der Drag-Fall, weil der FAB einem *gemerkten*
Platz zu ausweichen begann), nach der Regel „gemerkte Plätze bleiben heil“ und der
Geometrie-Prüfung **9 passed**.


## Nachtrag (17.11., zweiter Schritt): seitwaerts vor verschwinden

Auf dem produktiven Hub gemessen (authentifiziert, 390x844, Einstellungsseite 6801 px,
Scroll-Schritte zu 300 px = 20 Punkte, Trefferertest am Control-Mittelpunkt): **keine**
Verdeckung an einem einzigen Punkt.

**Klarstellung zu einem Messfehler in diesem Nachtrag:** der erste Lauf meldete „bei
3200 px war der FAB versteckt“. Die Sonde zeichnete den Zustand aber nur am exakten Punkt
3200 px auf — und der liegt gar nicht auf der 300er-Schiene (0, 300, …, 5700), also wurde
dort nichts aufgezeichnet und `null` als „versteckt“ gelesen. Ein zweiter Lauf, der das
Verstecken an *jedem* Punkt zaehlt, zeigt auf beiden Buendeln: 20 Punkte, 0 Verdeckungen,
0 versteckte. An dem Befund „nichts verdeckt“ aendert das nichts; die Aussage ueber ein
Verschwinden war falsch.

Der seitwaerts-Schritt ist damit **kein behobener Produktfehler**, sondern Robustheit: die
Regel muss nicht verschwinden, wenn senkrecht alles belegt ist. Belegt durch den Unit-Fall
„weicht seitwaerts aus, wenn senkrecht nichts frei ist“ — ohne seitwaerts-Kandidaten waere
das Ergebnis dort `null`, also der Knopf weg.

Live-Endstand nach beiden Schritten: Buendel `assets/index-BlL7PDjR.js` byte-identisch zum
gebauten Stand (sha256-Praefix `61d0ac862eae591c`, 718 691 Bytes), 20 Scrollpunkte,
0 Verdeckungen, 0 versteckte Punkte.

Messung nach dem zweiten Schritt: `apps/pwa/test/features/stt/fab-clearance.test.ts`
**10 passed** (neu: „weicht seitwaerts aus, wenn senkrecht nichts frei ist“; der Fall
„alles belegt“ braucht zwei Control-Spalten, sonst ist seitwaerts frei — das ist genau der
Unterschied), `e2e/specs/nyx-fab.spec.ts` **9 passed**, Typecheck Exit 0.
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
