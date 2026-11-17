# Statistik-Metriken (P56)

**Art:** referenz

**Stand:** 15.11.2026 ·
**Bezug:** [P56](../epics/EPIC-P56-statistiken-page-metrik-suite.md),
[ADR-0079](adr/0079-statistik-verteilungen-und-datenluecken.md).

## Startumfang und Datenquellen

T56.1a definiert und prüft Verteilungen für vorhandene `TurnMetric`-Werte:
Dauer, Tokenmenge, fehlgeschlagene Züge und geschätzte Token-Züge je Adapter
und aufgezeichneter Modell-ID. `deriveTurnMetrics` rekonstruiert die Eingabe
aus `NormalizedEvent`; die vorhandene Tabelle `turn_metrics` ist ein Cache.
Das ist noch keine Statistik-Seite, Rollup-Engine oder vollständige Session-
Erfolgsquote. P30/P31 bleiben On hold. T56.5 und AC-P56-6 bleiben gesperrt.

T56.1b präzisiert und testet die übrigen Session-/Gate-/Team-/Tool-Metriken
nach belegten Quellen (Verträge `SessionStatistics`, `GateWaitStatistics`,
`ToolStatistics`, `TeamTaskStatistics` in `@ancientvoid/contracts`; Ableitungen
in `packages/core/src/modules/statistics/`). Belegte Grundlage ist allein das
Journal (`NormalizedEvent`) bzw. der Team-Record; keine Zahl wird aus
Lücken geraten. Belegt ist nur, was die unten genannten Marker hergeben —
fehlende terminale oder korrelierte Fakten bleiben ausdrücklich unbekannt:

Die spätere Aggregation benötigt zusätzlich Session-/Host-/Projektbezug und
belegte Team-Zuordnung. Rohdaten und aufgezeichnete IDs erhalten; ein
Adaptername allein ist kein Provider-Nachweis. Ein fehlender Modellname wird
als `null` gruppiert, ohne einen Standardnamen zu erfinden. `TurnMetric.model`
stammt aus der beim Ableiten übergebenen Identität; historische Modellwechsel
sind damit allein nicht bewiesen. T56.2 muss deren zeitliche Herkunft prüfen
und Unbelegtes als unbekannt führen. Die Normalisierung
über einen Katalog ist erst nach Wiederaufnahme von P31 möglich.

## Gemeinsame Rechenregeln

- Alle Verteilungen: `n` = gemeldete Werte, `missing` = fehlende Werte,
  p50/p90/p95. Sortierte Werte `x`: Position `(n-1)*q`, linear zwischen den
  benachbarten Werten interpolieren. Ohne Messung sind Quantile `null`.
- `0` ist ein gemeldeter Wert. `null` wird weder zu Null noch zu einem
  erfolgreichen Ergebnis umgedeutet. Negative/NaN/Infinity-Werte ablehnen.
- `smallSample` ist bei `n < 10` wahr. Fehlende Messungen erhöhen `n` nicht.
  Token-Schätzungen zusätzlich über `estimatedTokenTurns` kenntlich machen.
- Züge aller Ergebnisse zählen. `estimateRun` ist eine Prognose erfolgreicher
  Züge und darf nicht als Filter für diese Statistik wiederverwendet werden.
- Quote: belegte passende Fälle / belegte Fälle mit auswertbarem Ergebnis.
  Nenner `0` ergibt `null`, nicht `0 %`. Unbekannte Fälle separat ausweisen.
- T56.2 muss vor dem Rollup die Session-/Zeitraumauswahl und offenen Intervalle
  festlegen. Bereits abgeschlossene Züge werden vollständig ausgewertet;
  Nachträge müssen eine deterministische Neuberechnung ermöglichen.
- `failedTurns` zählt exakt das vorhandene `TurnMetric.outcome === "error"`,
  einschließlich dort als Fehler geführter Unterbrechungen.
- `deriveSessionFacts` klassifiziert den **letzten** terminalen Marker eines
  Journals: `session.turn_end` mit `reason: "error"`/`code !== 0` → `error`,
  `reason: "interrupted"` → `interrupted`, sonst → `completed`;
  `session.stopped` (Nutzerstop) → `stopped`. Ohne Marker bleibt der Grund
  `null` (offen). Ob eine Session überhaupt beendet war, entscheidet erst die
  Rollup-Auswahl (T56.2) anhand `SessionRecord.status` — ein Journal allein
  weiß das nicht.
- Ein beendeter Zug ist kein beendetes Projekt, keine erfolgreiche Session
  und kein bestandenes Team-Task-Gate. `stalled` und `context_exhausted`
  sind im EventStore nicht belegt; sie
  bleiben unbekannt, bis ein ADR sie einführt. Kein Erfolgsurteil aus
  `worker_done`: `TeamTaskStatistics.workerEndRate` ist eine Worker-Ende-
  Quote; eine Gate-Erfolgsquote ist nicht belegt.
- Gate-Wartezeiten koppeln `tool.permission_requested` ↔
  `tool.permission_answered` über die `approvalId` (auch `timed_out`);
  `tool.auto_approved` wartet nie und zählt ohne Warteintervall. Offene
  Gates (ohne Antwort) liefern kein Intervall. Team-Gates speisen sich aus
  `TeamGate.openedAt/answeredAt`.
- Tool-Fakten korrelieren `tool_use.payload.id` ↔ `tool_result.payload.toolUseId`.
  Der Name steht in `payload.tool` (opencode) oder `payload.name` (übrige
  Adapter); fehlt beides, bleibt er `null` (eigener Bucket, kein geratener
  Name). Fehlerquote = `failed / (failed + ok)` über belegte `isError`-Werte;
  Ergebnisse ohne `isError` und Aufrufe ohne Ergebnis werden getrennt
  ausgewiesen, nie als Erfolg gezählt. Doppelte Call-Ids, doppelte Ergebnisse
  oder Ergebnisse ohne Aufruf werden abgelehnt (Fail loud), statt Replay
  still mitzuzählen.
- Recovery-Zeit = `session.interrupted` bis zum nächsten **erfolgreich**
  beendeten Zug; der Unterbrechungsabschluss selbst (`reason: "interrupted"`)
  und fehlerhafte Fortsetzungen zählen nicht. Ohne solchen Weiterlauf bleibt
  die Recovery unbekannt.
- Input-/Output-Tokens, Cache-Read/-Write und Kontext-Peak sind nicht über
  alle Provider kanonisch belegt (`tokensEst` ist eine Zahl ohne Aufteilung,
  Fenstergrößen fehlen) — sie bleiben unbekannt, bis ein belegter Faktenbestand
  existiert. EUR-Kosten (gesperrt bis P31) und Compression (gesperrt bis P55)
  unverändert.
- Daten enthalten keine neue kanonische Wahrheit. Wiederholung auf derselben
  Journalbasis ergibt dieselben Gruppen und Zahlen; Eingabereihenfolge egal.
  Doppelte `(sessionId, turn)` werden als Fehler zurückgewiesen.

## Feldliste für den gesamten P56-Scope

| Kennzahl | Einheit / Berechnung | Beleg und Grenze |
|---|---|---|
| Session-Wallzeit | ms zwischen erstem/letztem Session-Event | T56.1b `deriveSessionFacts`; laufende Session kein terminales Ergebnis |
| Aktive Dauer | ms, Summe beendeter Zug-Intervalle | T56.1b; offener Zug zählt nicht (`openTurn`), Lücken werden nicht geraten |
| Gate-Wartezeit | ms je zusammengehörigem Öffnen/Antworten | T56.1b (`approvalId`-Kopplung, `timed_out`/`open`/`auto_approved` getrennt); Team-Gates über `TeamGate` |
| Züge / Zugdauer | Anzahl; ms-Verteilung | `deriveTurnMetrics`, in T56.1a implementiert |
| Session-Endgrund | Anzahl/Quote je belegtem Grund | T56.1b: `completed`/`error`/`interrupted`/`stopped` (letzter terminaler Marker); `stalled`/`context_exhausted` nicht belegt → unbekannt |
| Tokens pro Zug | Token-Verteilung + Herkunft/Abdeckung | `TurnMetric.tokens/tokensSource`, in T56.1a implementiert |
| Input-/Output-Tokens | getrennte Token-Verteilungen | Adapter-Payloads teils vorhanden; nicht über alle Provider kanonisch belegt |
| Cache-Read/-Write | getrennte Token-Verteilungen; Cache-Quote | nur explizit gemeldete Werte; fehlend ist unbekannt |
| Kontext-Peak | größter belegter Füllstand / belegtes Fenster | ohne Fenstergröße keine Prozentzahl |
| EUR-Kosten | aus versionierten Preisen und Tokens | gesperrt bis P31; vorhandenes USD-Feld nicht als EUR ausgeben |
| Compression | before/after/saved/ratio je Request/Plugin | gesperrt bis P55-Vertrag, inklusive Skips/Fehlern |
| Netto-Compression | Ersparnis gegenüber Zusatzlatenz/Cache-Effekt | gesperrt bis P55, vergleichbare Belege nötig |
| Team-Task-Erfolg | auswertbare Task-Enden (done/failed/unknown) | T56.1b `workerEndRate`; Gate-Erfolgsquote nicht belegt (`done` ≠ Gate bestanden, P40-Regel) |
| Retry-Rate | Anteil Tasks mit höchster Dispatch-Generation > 1 | T56.1b; Team-Generationen, keine Session-Fortsetzung als Retry umdeuten |
| Abbruchquote | belegte Abbrüche / auswertbare Enden | fehlende Enden separat, nicht aus laufenden Sessions ableiten |
| Recovery-Zeit | ms zwischen `session.interrupted` und nächstem erfolgreich beendeten Zug | T56.1b; ohne belegten Weiterlauf unbekannt |
| Tool-Calls | Anzahl/Verteilung je Session und Tool | T56.1b; Name aus `payload.tool`/`payload.name`, sonst `null`; Replay-Doppelungen abgelehnt |
| Tool-Fehlerquote | belegte Fehler / korrelierte Ergebnisse | T56.1b `failureRate` über belegte `isError`; fehlende/uneindeutige Ergebnisse getrennt |
| Tool-Timeouts/-Hangs | Anzahl/Quote expliziter Timeout-/Hang-Fakten | nicht aus langer Laufzeit oder Text erraten |

T56.2 ergänzt den nachführbaren Rollup-Cache (`StatisticsRollup`,
Migration 36): Fakten je Session/Team in SQLite, Nachführung über
basis_last_seq/basis_updated_at, prune entfernt weggefallene Quellen,
rebuild() rekonstruiert alles aus Journal und Team-Record (K7). Die
Leseseite liefert nur Aggregate; Schnitte nach Zeitraum/Projekt/Host
brauchen zusätzlich Cache-Dimensionen und entstehen mit der Page (T56.3).
T56.3–4 ergänzen Schnitte nach Zeitraum/Projekt/Host/Harness/Orchestrator,
Vergleiche, Anomalien und CSV. Jede Zahl braucht Einheit, Datenabdeckung und
Quellennachweis. Bestehende Ereignisse nicht nachträglich mit erfundenen
Provider-/Orchestrator- oder Tokenangaben auffüllen. Neue Event-Verträge erst
nach eigenem ADR und belegter Notwendigkeit; T56.1a/T56.1b ergänzen keine Events.
