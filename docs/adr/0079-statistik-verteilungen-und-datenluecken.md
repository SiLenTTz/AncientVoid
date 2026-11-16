# ADR-0079 — Statistik-Verteilungen aus belegten Zugmetriken

**Status:** angenommen für T56.1a (15.11.2026)
**Bezug:** [P56](../../epics/EPIC-P56-statistiken-page-metrik-suite.md),
[ADR-0023](0023-honest-metrics.md), K5/K7.

## Kontext

P30/P31 sind ausdrücklich On hold. P44 und P55 benötigen diese Basis.
Der Nutzer beauftragt am 15.11.2026 den sinnvollsten nächsten Start aus
P44/P55/P56. P56 beginnt deshalb mit einem unabhängigen Grundlagenteil;
Katalog-/Compression-Anbindungen werden dadurch nicht freigegeben.

`TurnMetric` und `deriveTurnMetrics` liefern bereits aus JSONL ableitbare
Zugdauer, Tokenmenge samt Herkunft und Ergebnis. `estimateRun` verwendet
absichtlich nur erfolgreiche Züge für Prognosen. Diese Auswahl wäre für
Statistiken verzerrend. Adapter-ID ist außerdem kein Provider-Nachweis;
ein beendeter Zug ist kein belegtes Session-/Task-Erfolgsurteil.

## Entscheidung

- Additive Verträge `StatisticsDistribution` und `TurnStatistics` liegen in
  `@ancientvoid/contracts`. Bestehende Event-/Adapter-/Worker-Verträge bleiben
  unverändert; die neuen Objekte sind abgeleitete Lesemodelle, keine Events.
- Verteilungen führen `n`, `missing`, p50/p90/p95 und `smallSample`.
  Quantile interpolieren linear bei Index `(n - 1) * q`, entsprechend dem
  bestehenden Laufzeit-Schätzer. Werte bleiben ungerundet.
- `null` ist eine fehlende Messung; eine gemeldete Null zählt als Messung.
  Ohne Messungen sind alle Quantile `null`. Bei `n < 10` ist `smallSample`
  verpflichtend wahr. Ungültige, negative oder nicht endliche Werte scheitern.
- Die erste Aggregation gruppiert ausschließlich nach belegter Adapter-/
  Modell-ID, zählt fehlgeschlagene Züge mit und nennt geschätzte Token-Züge
  separat. Modell `null` ist ein eigener Bucket, kein geratenes Standardmodell.
- `(sessionId, turn)` muss eindeutig sein. Doppelte Eingaben werden sichtbar
  abgelehnt, statt Replay-Daten unbemerkt doppelt zu zählen. Erneutes Ableiten
  desselben Journals ergibt dieselbe Ausgabe; Reihenfolge der Eingabe ist egal.
- Die Datenquellen und Grenzen für den gesamten P56-Scope stehen in
  [Statistik-Metriken](../statistik-metriken.md). P31-Normalisierung,
  EUR-Preise und P55-Compression bleiben gesperrte Erweiterungen.

## Konsequenzen

T56.1a liefert getestete Rechen-/Vertragsgrundlagen. Rollup-Persistenz,
HTTP-API, PWA und CSV folgen in eigenen Aufgaben; P56 ist damit nicht fertig.
Der Schritt ergänzt keinen Store und keinen Netzwerkzugriff. K7 bleibt beim
vorhandenen JSONL; ein späterer Cache muss daraus rekonstruierbar sein.
Die Objekte sind REST-/Rollup-Daten, keine neuen EventBus-Payloads (K5).
Eine fachliche UI-Darstellung oder Task-Erfolgsquote wird nicht vorgetäuscht.
