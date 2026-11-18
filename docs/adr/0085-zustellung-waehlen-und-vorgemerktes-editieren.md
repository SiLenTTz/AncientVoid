# ADR-0085: Zustellung wählen und Vorgemerktes nachträglich ändern

Status: akzeptiert (2026-11-17), mit Nachtrag 2026-11-18 (Stelle und Symbol der Zustellwahl)

## Kontext

Kai steuert Pi vom Handy (PWA, oft nur ein Daumen). Bislang galt beim Senden während eines
laufenden Zugs eine einzige, vorgegebene Regel: die Meldung wird **vorgemerkt** und geht am
Zugende raus (ADR-0076, ADR-0074). Wer wollte, dass Pi die Meldung **sofort** aufgreift, hatte
in der Oberfläche keinen Weg — der Knopf hieß „Vormerken“, und „Jetzt senden“ in der
Warteschlange wurde für Next-Turn-Adaptern grundsätzlich abgelehnt.

Zwei Wünsche sind offen:

1. **Zustellung wählen:** dieselbe Meldung kann „am Zugende“ oder „jetzt“ gemeint sein.
2. **Nachträglich ändern:** eine vorgemerkte Meldung ist beim Tippen auf dem Handy oft
   halbfertig — Text korrigieren und die Reihe umhängen (diese zuerst, jene zuletzt), ohne
   sie wegzuwerfen und neu zu tippen.

Dabei darf ADR-0074 nicht aufgeweicht werden: für Claude & Co. verbietet er einen zweiten
Prozess auf dieselbe native Session. `steer: true` heißt bei diesen Adaptern „lenkt im
nächsten Zug“, nicht „nimmt Eingaben mitten im Zug an“. Die Unterscheidung fehlt im Contract.

## Entscheidung

**1. Neue Capability `midTurnInput` (Contracts, additiv).**
`AdapterCapabilities.midTurnInput?: boolean` sagt zu, dass der Adapter eine Meldung **mitten
im laufenden Zug** annimmt, ohne eine zweite native Session zu öffnen. Pi setzt sie auf `true`
(jeder Lenk-Aufruf ist ein eigener Lauf). Alle anderen Adapter lassen sie weg — damit bleibt
die Ablehnung aus ADR-0074 für sie unverändert erhalten.

**2. Zustellung ist eine ausdrückliche Wahl, nie eine Annahme.**
Der Composer hat einen Chip `⏳ am Zugende` / `⚡ lenken` (localStorage
`ancientvoid.queueDelivery`, bleibt über Neuladen gleich). Der Hauptknopf behält seine eine
Stelle und heißt passend „Vormerken“ oder „Jetzt lenken“. Der Chip erscheint **nur**, wo die
Zusage besteht: `midTurnInput === true` oder `promptDelivery !== "next-turn"` (Default „live“,
ADR-0076). Bei Claude gibt es die Wahl sichtbar nicht — die Oberfläche stellt nichts zur
Verfügung, was der Hub ablehnen würde.

**3. Core erzwingt die Vormerkrule nur ohne Zusage.**
`SessionManager.sendPrompt` merkt bei `meta.queue === false` nur dann zwangsweise vor, wenn
weder `midTurnInput` noch Live-Zustellung zugesagt ist. `sendQueuedNow` lehnt wie bisher ab
(nun zusätzlich abgesichert durch `midTurnInput !== true`) und behält den bisherigen Text.

**4. Die Warteschlange ist editierbar.**
Neue Route `PATCH /api/sessions/:id/queue/:queueId` mit `text` und/oder `move: "front" |
"back"`. Core: `SessionQueue.updateText`, `SessionQueue.moveTo`, darüber
`SessionManager.editQueued`. Für Einträge im `uncertainQueue` (Annahme unklar) sind Text und
Reihe **gesperrt** — sonst würde über einen Zustand entschieden, der nicht beobachtbar ist.

**5. Reihenfolge ist gespeichert, nicht Restzeit-Reihenfolge.**
Migration 35 (`queue-position`) ergänzt `session_queue.position` (bestehende Zeilen bekommen
nach `created_at` Positionen). `list()` sortiert `position, created_at, id`. `moveTo` verschiebt
mit zwei UPDATEs, statt alle Positionen umzuschreiben.

**6. Neue Events, damit der Verlauf die Änderung zeigt.**
`session.queue_edited`, `session.queue_moved` (Summary, Payload ≤ 4 KB, K5). Sie sind
Zusatz-Information, kein Ersatz für `session.queued`/`session.prompt`.

## Grenzen (bewusst)

- **Kein Editing von Sende-Status.** `delivery: "unknown"` bleibt unveränderlich sichtbar;
  Bearbeiten ist dort gesperrt (Fail loud statt raten).
- **Kein freies Ziehen (Drag & Drop)** — auf dem Handy sind „nach vorn / nach hinten“ die
  billigeren, treffsicheren Gesten; echte Mehrfach-Umhängungen sind bisher nicht verlangt.
- **Keine neue State-Quelle:** die Reihe lebt in SQLite (`session_queue`), das aus dem
  EventStore-Recovery-Pfad heraus nachbaubar bleibt (K7) — `position` ist Auftrags-Reihenfolge,
  kein Weltzustand, der rekonstruiert werden muss.
- **Die Wahl gilt je Gerät** (localStorage), nicht je Session; geteilte Geräte teilen sie sich.

## Konsequenzen

- Contracts sind erweitert (additiv, keine Bruchstelle): `midTurnInput`, `QueueEdit`,
  `QueuePatch`, `position` im `QueuedPrompt`.
- Adapter, die wie Pi mitten im Lenken arbeiten wollen, setzen `midTurnInput: true` und
  tragen damit die Verantwortung, dass kein zweiter Prozess auf dieselbe Session entsteht.
- Die PWA muss die Warteschlange nach Änderungen sofort neu zeichnen (optimistisch) und bei
  Fehlern zurücknehmen — der Hub ist die Wahrheit (Test: „↑ ↓ und ✎ wirken beim Hub, nicht
  nur in der Ansicht“).
- Das Funktionsinventar (S36) führt die Zustellwahl und das nachträgliche Ändern als
  dokumentierten Weg; Nachweis ist `spec:pause-queue.spec.ts`.

## Nachtrag (2026-11-18): der Chip sitzt rechts vom Hauptknopf und trägt ein Linienzeichen

Nutzerfund beim Blick aufs Dock (Kai, Handy): „das Icon unten, das mit dem am Zugende, sieht
ein bisschen billig aus … und auch nicht an der Stelle, sondern rechts von dem Vormerken-
Button, und von der Größe, dass das zum Rest stimmig passt.“

1. **Stelle:** der Chip steht **rechts** vom Hauptknopf. Reihenfolge im Dock = erst die
   Handlung („Vormerken“ / „Jetzt lenken“), dann die Art der Zustellung. Der Punkt aus
   Abschnitt 2 — der Hauptknopf behält seine eine Stelle — bleibt unberührt.
2. **Symbol statt Emoji:** `⏳`/`⚡` sind geräteabhängig farbig (auf Android ein buntes
   Piktogramm neben einem violetten Formknopf) und tragen keine Linienbreite des
   Designsystems. Ersetzt durch eigene `<svg>`-Zeichen (Uhr, Blitz) im Idiom des Composers:
   `stroke: currentColor`, 1,8 pt Linie, runde Enden. Eine Sanduhr — naheliegend — fiel in
   der visuellen Pruefung durch: sowohl konturiert (las sich wie ein „Ƨ“) als auch gefuellt
   (wie ein Pokal) war sie bei 16–18 px nicht zu lesen; die Uhr ist es.
3. **Baustein statt Rohklasse:** der Chip ist der Designsystem-Baustein `Chip`
   (`aria-pressed` über `active`), nicht mehr die Roheigenschaft `.delivery-chip`. Die Höhe
   folgt 44 px wie `.ui-button`, damit er mit dem Hauptknopf eine Zeile bildet; der gewählte
   Zustand ist **angetönt** (`color-mix` mit `--accent`), ausgefüllt bleibt der Hauptknopf
   allein. Auf Handys (`max-width: 639px`) sind Padding, Abstand, Schrift und Symbol enger
   gestellt — sonst bricht der Chip in eine zweite Zeile um (gemessen: bei 360 px bleiben
   119 px frei, der weitere Chip braucht 129 px in der PC-Dosierung, 110 px in der Handy-Dosierung).

Nachweis in `e2e/specs/pause-queue.spec.ts`: Text ohne Emoji, eigenes `<svg>`, Chip rechts vom
Hauptknopf (Bounding-Box) und höchstens 2 px Höhenunterschied zum Hauptknopf.
