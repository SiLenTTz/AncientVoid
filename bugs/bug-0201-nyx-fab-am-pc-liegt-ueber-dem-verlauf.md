# BUG-0201 — am PC liegt der Nyx-FAB mitten über dem Chat-Verlauf

- **Status:** done (Platzierung geändert, gemessen)
- **Schicht:** pwa (Speech-FAB, EPIC-P14/BUG-0138/BUG-0176-Familie)
- **Schwere:** S3 — kein Funktionsverlust, aber der Knopf deckt eine Zeile des Verlaufs zu
  und wirkt wie ein Fehler (Sichtprüfung am produktiven Hub, 17.11.)

## Beobachtung

Screenshot vom produktiven Hub (`#/sessions/18830ec6…`, 1280×800): der FAB sitzt bei
**608,368** — mitten im Lesefeld, direkt über der Ereigniszeile #14804 (`session.queue…`).
Gemessen per `getBoundingClientRect`: FAB-Rechteck `[608, 368, 64, 64]` innerhalb des
`.tail-scroll`-Bereichs.

## Ursache

`defaultFabPos("pc")` lieferte die Viewport-Mitte (`(vw-64)/2`, `(vh-64)/2`). Die
Ausweichregel aus BUG-0199 schützt nur **Bedienelemente** (Geometrie der Control-Mittelpunkte),
Textzeilen sind nicht geschützt — mitten im Verlauf ist nichts davon, also blieb der Knopf dort.

## Behoben

PC-Default ist jetzt **unten links in der Sitzungsliste**: `x = 96` (rechts der festen
Icon-Leiste), `y = vh - 64 - 32` (über der Statuszeile). Diese Fläche war im Screenshot leer.
Ziehen bleibt möglich, eine gemerkte Position des Nutzers wird weiterhin nicht verschoben.

## Messung

| Fall | Ergebnis |
|---|---|
| neu: `nyx-fab.spec.ts` „BUG-0201: am PC sitzt der FAB nicht über dem Chat-Verlauf“ (1280×800, Überlappung mit `.tail-scroll`) | **bestanden** |
| neu angepasst: „mit echter Maus ziehen“ — von links unten nach **rechts/oben** gezogen (nach links/unten steht die Viewport-Klemme bei 0, das hätte nur die Klemme getestet) | **bestanden** |
| `npx vitest run apps/pwa/test/features/stt` | **10 passed** (`fab-position.test.ts` prüft jetzt das freie Band unten links statt „mittig“) |

## Nummer

**0201** (0199 = FAB über Control auf langen Seiten, 0200 = „Mehr“ hinter der Steuerung).
