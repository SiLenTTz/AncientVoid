# ADR-0095 — die Quelle der Spracheingabe ist pro Gerät wählbar

## Kontext

BUG-0225: Am Handy kam das Diktat sofort, am Tablet lahm. Beide Geräte hängen an
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
2. **Sichtbar, aber nicht im Weg**: ein Menü mit den drei Quellen (Design-System
   `Segmented`) und einem Hinweis, der die Quelle beim Namen nennt — bei Browser
   explizit „dein Gesprochenes verlässt das Gerät“. Es kommt, wenn man den
   Mikro-Knopf **gedrückt hält**, und steht zusätzlich in den Einstellungen
   (Gruppe „Spracheingabe“). Die Entscheidung darf nicht unsichtbar im Mikro-Knopf
   stecken — sichtbar heißt aber nicht: dauerhaft platziert.
3. **Der Knopf beschreibt, was ein Druck tut** (Titel "Spracheingabe lokal (…)"/
   "(Browser, meist Cloud)"), nicht die Einstellung dahinter.
4. **Kein stiller Quellenwechsel.** Bei "lokal" und unerreichbarer eigener Erkennung
   bleibt der Knopf blockiert und sagt, woran es liegt. Wer "browser" gewählt hat,
   bekommt nicht heimlich den Hub. Der Auto-Pfad bleibt der einzige, der ausweicht —
   und sagt danach beim nächsten Drücken, was er tut.
5. **Ohne Mikrofon und ohne Browser-Erkennung** erscheint das Menü gar nicht — wo
   keine Quelle zur Wahl steht, fragt das Menü nach nichts Sinnvollem.

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
  ist BUG-0225. Schnelligkeit ist hier ein echtes Qualitätskriterium.
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

## Nachtrag (19.11.2026): die Wahl kostet keinen Dauerplatz mehr

Die erste Fassung stellte den Segment-Schalter **fest unter die Eingabe**. Im Live-Bild
zeigte sich: diese Zeile kostet in der Eingabgegend 60 px Höhe — genau dort, wo Composer,
Vorlage-Zeile und Dock um jeden Streifen ringen. Kai: „nimmt viel zu viel space ein“.
Deshalb:

- Die feste Zeile ist **weg**; die Eingabgegend ist wieder so hoch wie vorher.
- **Mikro-Knopf gedrückt halten (500 ms)** öffnet das Menü am Knopf. Wer zieht
  (Knopf positionieren), bricht das Halten ab; kurzes Tippen nimmt weiter auf.
- Das Menü **klebt am Knopf**: es misst die Knopfposition beim Öffnen und danach erneut
  (der Knopf setzt sich beim Seitenwechsel, bei Tastatur und beim Wachsen des Docks neu),
  klemmt sich seitlich ins Bild und rutscht nach unten, wenn nach oben kein Platz ist.
  Es schließt nach der Wahl, bei Escape und bei einem Druck außerhalb.
- Dieselbe Wahl steht in **Einstellungen → Spracheingabe** — der nachschlagbare Ort,
  damit man sie auch ohne Kenntnis der Geste findet.
- Ohne jede Quelle (kein Mikrofon, keine Browser-Erkennung) öffnet das Menü nicht.
- Nebenbefund, mit behoben: eine `Segmented`-Zeile in den Einstellungen quetschte am
  Handy ihre Beschriftung auf acht Zeilen („Mikro- / Knopf / gedrückt / halten …“). Jetzt
  stapeln schmale Zeilen mit breitem Bedienelement (`24-settings.css`): Beschriftung
  oben, Schalter darunter.
