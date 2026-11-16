# ADR-0023 — Ehrliche Messwerte: woher eine Zahl kommt, steht daneben

**Status:** akzeptiert · **Betrifft:** EPIC-P7 T7.7, AC-P7-6 (zweiter Teil),
`packages/contracts/src/sessions/metrics.ts`, `SessionRecord.metrics`,
`NormalizedEvent.{tokensSource,costSource}`, Migration 15, PWA-Bericht/Übersicht.
Ergänzt ADR-0003 und ADR-0006.

## Kontext

`costUsd` und `tokensEst` einer Session sind Summen der Events (ADR-0003,
ADR-0006). Eine 0 kann dreierlei heißen: „kostet nichts“, „der Harness meldet
das nicht“ oder „einige Züge haben gemeldet, andere nicht“. Die PWA machte
den Unterschied nur grob über `capabilities().cost` (ein Schalter pro
Adapter). Falsch wurde es an diesen Stellen:

- opencode meldet `cost: 0` für Abo-Pläne und lokale Anbieter. Das stand als
  „$0“ da, obwohl niemand einen Preis kennt.
- codex rechnet Kosten aus einer eigenen Preistabelle. Das ist eine Schätzung,
  wurde aber wie eine Anbieterzahl gezeigt.
- Der Dummy erfindet Tokens. Das ist eine Näherung und wurde ebenfalls wie
  eine Anbieterzahl gezeigt.
- Ein Harness, der nur in manchen Zügen zählt, ergibt eine zu kleine Summe
  ohne Hinweis darauf.

## Entscheidung

1. **Quelle pro Event:** `tokensSource`/`costSource` ∈ `native | estimated`,
   fehlt = `native` (der Anbieter hat es gemeldet). Preistabellen und
   Näherungen setzen `estimated` (codex-Kosten, Dummy-Tokens).
2. **Beleg pro Zug:** Der Hub zählt in `emitEvents` je Session
   (`MetricCounters`): beendete Züge (`session.turn_end`), Züge mit
   Kosten- bzw. Token-Wert, Events mit Wert, ob je geschätzt wurde. Die
   Zähler werden mit der Session gespeichert (Spalte `metric_counters`).
3. **Qualität pro Session** (`SessionRecord.metrics.{cost,tokens}`):
   `unknown` (kein Wert je gemeldet — die 0 ist kein Wert) · `partial`
   (nicht jeder beendete Zug hat gemeldet — die Summe ist eine Untergrenze) ·
   `estimated` (jeder Zug, mindestens einmal geschätzt) · `native`.
4. **Keine bestätigte Null ohne Beleg:** opencode-`cost: 0` wird nicht als
   Kostenwert übernommen, bleibt also `unknown`.
5. **Anzeige:** Das Wort steht vor der Zahl: „nicht gemeldet“,
   „mind. $0.12“, „≈ $0.40“. Die Tages-Summe ist nur dann eine glatte Zahl,
   wenn jede Session `native` ist. Sonst heißt es „mind. …“ oder
   „nicht gemeldet“.
6. **Kontingent bleibt getrennt:** Das Account-Kontingent (ADR-0004) wird
   nie auf Sessions summiert und steht im Bericht als eigene Zeile
   „Kontingent (Adapter-weit)“.
7. **Altdaten (Migration 15):** Eine Session mit Summe > 0 von vor dieser
   Änderung kann nicht belegen, dass jeder Zug gemeldet hat, und wird deshalb
   `partial`, nie `native`. Summe 0 ergibt `unknown`.

## Folgen

- Ein Adapter, der künftig schätzt, muss `…Source: "estimated"` setzen.
  Sonst gilt seine Zahl als Anbieterzahl. Tests für codex und den Dummy
  halten das fest.
- `SessionSummary` (Reporting, ADR-0009) trägt `metrics`, damit Berichte
  ebenfalls keine falsche 0 weitergeben.
- Ältere Flotten-Peers liefern kein `metrics`. Die PWA fällt dann auf den
  alten Schalter `capabilities().cost` zurück.
