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
- Ein beendeter Zug ist kein beendetes Projekt, keine erfolgreiche Session
  und kein bestandenes Team-Task-Gate. Keine Erfolgsaussage aus `worker_done`.
- Daten enthalten keine neue kanonische Wahrheit. Wiederholung auf derselben
  Journalbasis ergibt dieselben Gruppen und Zahlen; Eingabereihenfolge egal.
  Doppelte `(sessionId, turn)` werden als Fehler zurückgewiesen.

## Feldliste für den gesamten P56-Scope

| Kennzahl | Einheit / Berechnung | Beleg und Grenze |
|---|---|---|
| Session-Wallzeit | ms zwischen erstem/letztem Session-Event | JSONL; laufende Session kein terminales Ergebnis |
| Aktive Dauer | ms, Vereinigung belegter Aktivitätsintervalle | vollständige LLM-/Tool-Intervalle fehlen teils; nicht aus Event-Lücken raten |
| Gate-Wartezeit | ms je zusammengehörigem Öffnen/Antworten | Operations-/Team-Gate-Fakten; offene Intervalle erst in T56.2 festlegen |
| Züge / Zugdauer | Anzahl; ms-Verteilung | `deriveTurnMetrics`, in T56.1a implementiert |
| Session-Endgrund | Anzahl/Quote je done/failed/cancelled/stalled/context_exhausted | nur expliziter terminaler Beleg, sonst unbekannt |
| Tokens pro Zug | Token-Verteilung + Herkunft/Abdeckung | `TurnMetric.tokens/tokensSource`, in T56.1a implementiert |
| Input-/Output-Tokens | getrennte Token-Verteilungen | Adapter-Payloads teils vorhanden; nicht über alle Provider kanonisch belegt |
| Cache-Read/-Write | getrennte Token-Verteilungen; Cache-Quote | nur explizit gemeldete Werte; fehlend ist unbekannt |
| Kontext-Peak | größter belegter Füllstand / belegtes Fenster | ohne Fenstergröße keine Prozentzahl |
| EUR-Kosten | aus versionierten Preisen und Tokens | gesperrt bis P31; vorhandenes USD-Feld nicht als EUR ausgeben |
| Compression | before/after/saved/ratio je Request/Plugin | gesperrt bis P55-Vertrag, inklusive Skips/Fehlern |
| Netto-Compression | Ersparnis gegenüber Zusatzlatenz/Cache-Effekt | gesperrt bis P55, vergleichbare Belege nötig |
| Team-Task-Erfolg | bestandene Task-Gates / auswertbare abgeschlossene Tasks | Team-/Dispatch-Fakten prüfen; `done` allein kein beliebig bestandener Test |
| Retry-Rate | Dispatches je Task; Anteil mit mehr als einem Versuch | Team-Generationen, keine Session-Fortsetzung als Retry umdeuten |
| Abbruchquote | belegte Abbrüche / auswertbare Enden | fehlende Enden separat, nicht aus laufenden Sessions ableiten |
| Recovery-Zeit | ms zwischen zugeordnetem Fehler und belegtem Weiterlauf | ohne Korrelationsbeleg unbekannt |
| Tool-Calls | Anzahl/Verteilung je Session und Tool | `tool_use`, Wiederholung/Replay nicht doppelt zählen |
| Tool-Fehlerquote | belegte Fehler / korrelierte Ergebnisse | AV nutzt auch `isError`; fehlende Resultate nicht als Erfolg zählen |
| Tool-Timeouts/-Hangs | Anzahl/Quote expliziter Timeout-/Hang-Fakten | nicht aus langer Laufzeit oder Text erraten |

T56.2–4 ergänzen Rollup, Schnitte nach Zeitraum/Projekt/Host/Harness/Orchestrator,
Vergleiche, Anomalien und CSV. Jede Zahl braucht Einheit, Datenabdeckung und
Quellennachweis. Bestehende Ereignisse nicht nachträglich mit erfundenen
Provider-/Orchestrator- oder Tokenangaben auffüllen. Neue Event-Verträge erst
nach eigenem ADR und belegter Notwendigkeit; T56.1a ergänzt keine Events.
