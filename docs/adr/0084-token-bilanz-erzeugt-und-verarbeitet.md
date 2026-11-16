# ADR-0084: Token-Bilanz — „erzeugt“ und „verarbeitet“ sind zwei verschiedene Zahlen

**Status:** angenommen (2026-11-16) · **Bezug:** BUG-0182, ADR-0006, ADR-0032

## Kontext

Die Statuszeile zeigte `Σ 244.707.213 Tokens`. An der echten Historie gemessen
(`events.jsonl`, 7.748 Events, 1.744 `pi.usage`-Events):

* Summe der pro Event gemeldeten Größe (`tokensEst`): **272.613.546**
* davon `usage.input` (der Kontext, den jeder Aufruf mitbekam): 271.666.206
* davon `usage.output` (was der Agent schrieb): **947.340**
* Kontext pro Aufruf: Median 156.447, Maximum 251.927

ADR-0006 legt fest: `tokensEst` ist **pro Ereignis** die Größe dieses einen
Modell-Aufrufs, und der Hub summiert sie auf die Session. Das ist arithmetisch
richtig, weil jeder Aufruf den ganzen Verlauf tatsächlich verarbeitet hat — aber
es summiert denselben Kontext ~1.700-mal. Als „Σ Tokens“ neben „Kontext 84 %“
liest es sich wie Verbrauch und ist es nicht. ADR-0032 verlangt ohnehin: echte
Zahlen, klar benannt, Unknown bleibt Unknown.

## Entscheidung

1. **Zwei Begriffe, zwei Zahlen.**
   * **verarbeitet** = Summe der pro Ereignis gemeldeten Aufrufgröße. Das ist das
     bestehende Feld `session.tokensEst` — es bleibt, aber es heißt in der
     Oberfläche „verarbeitet“, nicht „Σ Tokens“.
   * **erzeugt** = Summe der gemeldeten **Ausgabe**-Tokens eines Ereignisses. Bei
     Adaptern mit Reasoning-Anteil (`reasoningOutputTokens`) zählt der mit, denn
     Gedanken sind erzeugte Tokens; die gemeldete Aufteilung bleibt sichtbar.
   Ein einzelner „Σ Tokens“-Wert, der beides vermischt, ist verboten.
2. **Abgeleitet, nicht gespeichert.** Die Session-Bilanz wird aus dem EventStore
   gelesen (Übersetzung der Adapter-Formen: `input`/`inputTokens`,
   `output`/`outputTokens`, `reasoningOutputTokens`, `cachedInputTokens`). Es
   gibt **keine** neue Spalte und keinen neuen Zustand: K7 (Zustand aus JSONL +
   Snapshot rekonstruierbar) bleibt unverletzt, die Bilanz ist jederzeit
   nachrechenbar. Ein Cache pro `(sessionId, lastSeq)` ist rein flüchtig.
3. **Die Übersetzung liegt im Core, nicht in den Adaptern.** Adapter melden ihre
   provider-eigene Form (pi `input/output`, codex `inputTokens/outputTokens/
   reasoningOutputTokens/cachedInputTokens`, claude/cursor `input_tokens/
   output_tokens`). Ein Adapter, der dafür eigene Felder erfindet, würde den
   Contract fragmentieren.
4. **Geschätzt bleibt gekennzeichnet.** Stammt ein Wert aus `tokensSource:
   "estimated"`, zeigt die Oberfläche das. Ein fehlender Wert wird gesagt
   („unbekannt“), nicht mit 0 gefüllt.

## Grenzen (bewusst)

* Keine Kosten-Aussage — `costUsd` ist ein separates, anderes Problem (T7.7).
* Die Bilanz ist eine **Detail-Ansicht**-Zahl. Der EventStore-Scan ist O(Events);
  in der Sitzungsliste bleibt die gröbere `tokensEst`-Summe des Session-Datensatzes
  stehen (dort beschriftet „verarbeitet“).
* Abrechnungsnähe ist nicht gemeint: lokale Modelle rechnen nichts ab; „verarbeitet“
  ist geleistete Rechenarbeit, kein Verbrauch.

## Konsequenzen

* `apps/pwa/src/features/session/StatusLine.tsx` zeigt beide Werte beschriftet;
  „Σ … Tokens“ verschwindet.
* Neue Lese-Funktion in `packages/core/src/modules/sessions/` (öffentlich über den
  Modul-Index) und eine Hub-Route `GET /api/sessions/:id/tokens`.
* Tests müssen die Quadratur explizit abwehren: eine Fixture mit drei Aufrufen
  gleichem Kontext darf nicht das Dreifache des Kontexts als „erzeugt“ ausweisen.
