# ADR-0095 — die Quelle der Spracheingabe ist pro Gerät wählbar

## Kontext

BUG-0224: Am Handy kam das Diktat sofort, am Tablet lahm. Beide Geräte hängen an
demselben Hub. Der Grund ist nicht die Geschwindigkeit, sondern die Quellenwahl: Die
PWA hält ihre Entscheidung nur an einer Auskunft (`GET /api/stt`), die sie beim Start
**einmal** holt und bis zum kompletten Schliessen der App behält. Ein Gerät, das vor
dem STT-Ausbau oder wahrend eines Hub-Neustarts gestartet wurde, bleibt deshalb auf
der Browser-/Cloud-Erkennung — unsichtbar, ungewollt, und füer den Nutzer nur als
"warum ist das eine schnell und das andere langsam" erfahrbar.

Beide Quellen haben ihren Wert, und Kai will sie gemischt:

- **Browser-Erkennung**: sofortige Wort-füer-Wort-Vorschau, weil der Browser sie im
  Cloud-Dienst des Herstellers rechnet. Aber: das Gesprochene verlässt das Gerät, und
  die Fachwörter (Hub-Fachwortliste, Engine-Name) fehlen.
- **Eigene Erkennung am Hub** (whisper.cpp): bleibt auf dem Rechner, versteht die
  Fachwortliste, nennt die Engine im Endtext. Aber: auf dieser Maschine (CPU, Radeon
  ausgebaut) kostet ein 3–4-Sekunden-Schnitt 4,8–7 s — Live-Wörter kommen mit
  Verzögerung.

Wer nicht fragen kann, kann nicht entscheiden. Also fragen.

## Entscheidung

1. **Gespeicherte Wahl pro Gerät** in `localStorage`
   (`ancientvoid.stt-modus.v1`): `auto` (bisheriges Verhalten), `lokal`, `browser`.
   Kein Hub-Sync: die Wahl hängt an Hardware und Mikrofon, nicht am Konto.
2. **Sichtbar an der Eingabe**: ein Segment-Schalter (Design-System `Segmented`) plus ein
   Hinweis, der die Quelle beim Namen nennt — bei Browser explizit
   "dein Gesprochenes verlässt das Gerät". Die Entscheidung darf nicht im
   Mikro-Knopf versteckt stecken.
3. **Der Knopf beschreibt, was ein Druck tut** (Titel "Spracheingabe lokal (…)"/
   "(Browser, meist Cloud)"), nicht die Einstellung dahinter.
4. **Kein stiller Quellenwechsel.** Bei "lokal" und unerreichbarer eigener Erkennung
   bleibt der Knopf blockiert und sagt, woran es liegt. Wer "browser" gewählt hat,
   bekommt nicht heimlich den Hub. Der Auto-Pfad bleibt der einzige, der ausweicht —
   und sagt danach beim nächsten Drücken, was er tut.
5. **Ohne Mikrofon und ohne Browser-Erkennung** erscheint die Zeile gar nicht.

## Folgen

- Handy und Tablet können bewusst unterschiedliche Quellen haben; die Geschwindigkeits-
  unterschiede sind erklärt statt raten.
- Die Cloud-Nutzung wird ausgesprochen statt hingenommen — das ist die einzige
  Stelle, an der Diktat den Rechner verlässt.
- `data/ops`- und Hub-Seitig ändert sich nichts: keine neuen Endpunkte, keine SYNC.
- Die Speichergrenze der Ablage (ADR-0089/0093) bleibt unangetastet; es wird ein
  Schlüssel mit einem von drei kurzen Wörtern abgelegt.

## Abwägungen

- **Warum keine Hub-Einstellung?** Weil dieselbe Instanz ein schnelle Cloud-Handy und ein
  lokales Tablet haben darf. Eine Konto-Einstellung würde das eine gegen das andere
  ausspielen.
- **Warum nicht "immer lokal, wenn möglich"?** Genau das war der alte Zustand und das
  ist BUG-0224. Schnelligkeit ist hier ein echtes Qualitätskriterium.
- **Warum blockiert "lokal" statt auszuweichen?** Weil ein unaufgeforderter Wechsel in
  die Cloud eine Konsequenz hat, die niemand unbemerkt tragen sollte.

## Nachweise

- Specs: `apps/pwa/test/shared/stt-modus.test.ts` (11 Fälle: Merken, Neuladen, kaputter
  Speicher, ungültiger Wert, Entscheidungstabelle, Titel/Hinweis) und
  `e2e/specs/stt-modus.spec.ts` (4 Fälle: drei Quellen sichtbar; Browser-Wahl erzeugt
  **keine** Hub-Anfrage; Lokal-Wahl erkennt am Hub und bleibt nach dem Neuladen gesetzt;
  Lokal-Wahl weicht bei unerreichbarem Hub nicht in die Cloud aus).
- Regressionsfrei: `e2e/specs/voice-local.spec.ts` 7 Fälle und
  `e2e/specs/stt-ausfall-rückfall.spec.ts` 2 Fälle bleiben grün.
