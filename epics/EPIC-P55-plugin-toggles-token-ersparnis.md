# EPIC-P55 — Plugin-Toggles in den Einstellungen mit Token-Ersparnis-Nachweis

**Status:** Planungsentwurf · **Umsetzung:** gesperrt (wartet auf Nutzer-Review, beauftragt 2026-11-12) · **Phase:** P55
**Dauer:** 2–3 Agenten-Wochen (grobe Schätzung)
**Abhängigkeit:** P30-Exit-Kriterien grün (Plugin-/Sink-Rahmen); P31-Probe für Modell-/Tokenizer-Metadaten; Statistik-Datenmodell aus P56 abstimmen (gemeinsame Events).

## 1. Ziel

Plugins wie **Headroom (Context Compression)** und vergleichbare Tools lassen sich in den Einstellungen **ein- und ausschalten** — pro Scope (global, pro Loop/Harness, pro Session). Für **Transparenz** erfasst AV pro Plugin-Feuerung **wie viele Tokens eingespart wurden** (`tokens_before`, `tokens_after`, `tokens_saved`, Ratio) und zeigt das in den Plugin-Settings aggregiert an. Die **Qualität** der Kompression wird bewusst **nicht** bewertet — das bleibt menschliche Entscheidung (Doku-Hinweis in den Settings); AV liefert nur harte Zahlen.

## 2. Scope (In / Out)

**In:** Plugin-Registry mit Settings-UI und Scope-Toggles; Headroom-artige Compression als erster Plugin-Typ mit `pre-call`-Eingriff in die LLM-Kette; Token-Spar-Nachweis pro Request und aggregiert; Fail-safe/Override pro Session; Ereignis-Contract für P56-Statistiken.
**Out:** Automatische Qualitätsbewertung der Kompression; Kompression zwischen Orchestrator↔Worker-Kontextpaketen (P40-Pakete sind bereits kuratiert ≤4 KB — dort keine Compression); neue Provider-Anbindungen; Cloud-Senden von Metriken.

## 3. Design-Details

### 3.1 Plugin-Toggles in den Settings

- Abschnitt „Plugins" in den PWA-Settings: Liste der registrierten Plugins (P30-Registry), je Plugin: Status (an/aus), Scope-Auswahl (global / pro Loop / pro Harness / pro Session), Override-Möglichkeit während einer laufenden Session (wirkt ab nächstem Request, transparent im Session-Log).
- Default: **aus** (opt-in). Beide Schalterstellungen gehören in die E2E-Matrix — sonst entsteht ein doppelter ungetesteter Zustand.
- Toggle-Zustand ist Konfiguration (hub.config.json / Plugin-Registry), historische Runs ändern sich nicht rückwirkend.

### 3.2 Integration zwischen alle LLM-Calls

- Architektur: **Middleware/Callback-Pattern** am LLM-Aufrufpunkt (Referenz: LiteLLM `async_pre_call_hook` / Guardrail `mode: pre_call`; Headroom bietet `HeadroomCallback` bzw. `/v1/compress` als Sidecar). AV-intern: ein `ContextPlugin`-Interface mit `preCall(messages, model) → {messages, stats}`; alle LLM-Aufrufe der Harnesses/Worker laufen durch diesen einen Punkt.
- Erster Vertreter: Headroom-Kompression (oder äquivalente Pipeline). **CCR-Modus mit Retrieve-Pflicht**: Originale bleiben abrufbar (`headroom_retrieve`-Äquivalent); niemals `--no-ccr`/lossy ohne Wiederherstellungsweg.
- **Literal-Preservation:** Code, Diffs, Commands, IDs, Fehlermeldungen werden nicht verlustig komprimiert (Protect-Regeln im Plugin-Config; Referenz: `protect_recent`, `compress_user_messages:false`-Optionen).
- Der `model`-Name wird immer echt durchgereicht (Tokenizer/Context-Limit), auch bei Gateway-Präfixen.

### 3.3 Token-Ersparnis-Nachweis (Transparenz)

- Pro Feuern: `tokens_before`, `tokens_after`, `tokens_saved`, `compression_ratio` (after/before — niedriger = besser), `transforms_applied`, Plugin-Version, Modell, Session/Run-Bezug. Referenz-Contract: Headroom `/v1/compress`-Response.
- Settings-Ansicht je Plugin: Summen (gesparte Tokens, Ø-Ratio, betroffene Requests, Fehler/Skips) über wählbaren Zeitraum; Einzel-Requests über Statistik-Page (P56) einsehbar.
- Misslungene/übersprungene Kompressionen zählen explizit mit (Beitrag 0, Grund geloggt) — keine stillen Auslassungen.
- **Qualität:** Settings-Text weist ausdrücklich darauf hin, dass Token-Ersparnis ≠ Ergebnisqualität; Empfehlung: gezielt A/B über gleiche Aufgaben und menschliche Abnahme (Gate) bewerten.

### 3.4 Forschungsgrundlage (Recherche 2026-11-12, für Umsetzungsentscheidungen)

- **Headroom + LiteLLM:** Callback/Guardrail integriert Compression vor jedem Provider-Call; Antwort-Header/Stats liefern `tokens_saved`; Dollar-Ersparnis wird aus Input-Preis geschätzt (ohne Cache-Rabatte) — für AV: Euro-Schätzung erst wenn Preisdaten gepflegt sind (P31-Katalog), sonst nur Tokens.
- **CCR-Falle:** `mode:"ccr"`-Marker sind **dangling pointers**, wenn das Retrieve-Tool nicht injiziert ist und `/retrieve` nicht erreichbar — genau das ist in der Praxis schiefgegangen (Hermes-Erfahrung: komprimierte Marker ohne funktionierendes Retrieve-original). Pflicht: Retrieve-Weg E2E testen.
- **LLMLingua-2 (Microsoft):** bis 20x Kompression, extraktiv, geringer Qualitätsverlust in Benchmarks — Validierung auf AV-eigenen Workloads nötig, Benchmark-Zahlen sind nicht übertragbar.
- **Anthropic Context Editing + Memory Tool:** 84% Token-Reduktion im 100-Turn-Web-Search-Eval, +39% Performance kombiniert mit Memory-Tool — Beleg für „Clearing + externes Gedächtnis schlägt reines Zusammenfassen". P49-Knowledge-Vault ist AVs Äquivalent; Plugin-Architektur darf ihn nicht umgehen.
- **Prefix-Cache-Stabilität:** Cache-Modus (vorherige Turns einfrieren) vs. Token-Modus (maximale Ersparnis) ist ein echter Trade-off — als Scope-Option abbilden, Default cache-stabil für lange Sessions.

### 3.5 Risiken (ausdrücklich)

- Verlustbehaftete Kompression wird genau dann teuer, wenn Präzision zählt (Debugging, exakte Dateiinhalte) — deshalb Protect-Regeln + Retrieve-Pflicht + Default-off.
- Kompression kann Latenz und Prefix-Cache-Hits kosten; Netto-Effekt messen (P56-Metriken latency/cache-hit mitführen).
- Plugin-Ausfall darf den LLM-Call nicht blockieren: Fail-open konfigurierbar, aber geloggt (Fail-open ja, still nein).

## 4. Aufgaben (Checkliste T55.m)

- **T55.1** Plugin-Settings-UI (Liste, Toggles, Scopes, Override pro Session) auf P30-Registry.
- **T55.2** `ContextPlugin`-Interface am LLM-Aufrufpunkt; Headroom(-artige) Compression als erstes Plugin, CCR + Retrieve + Protect-Regeln.
- **T55.3** Stats-Contract: Ereignis je Feuern mit `tokens_before/after/saved/ratio/transforms`; Verschnitt mit P56-Events klären.
- **T55.4** Settings-Aggregatansicht (Zeitraum, Summen, Skip/Fehler-Gründe); Qualitätshinweis-Text.
- **T55.5** E2E beide Toggle-Stellungen; Retrieve-Weg-Test (Marker → Original zurück); Fail-open-Verhalten.
- **T55.6** Doku: Entscheidungshilfe wann an/aus; Abnahme mit Nutzer.

## 5. Acceptance Criteria (AC-P55-k)

- **AC-P55-1:** Jedes registrierte Plugin ist in den Settings an/aus schaltbar (global + mind. ein feinerer Scope); Default ist aus; Änderung ist im Session-Log sichtbar.
- **AC-P55-2:** Pro Request mit aktivem Plugin sind `tokens_before/after/saved/ratio` erfasst und in den Settings aggregiert ablesbar; Skips/Fehler zählen mit Grund mit.
- **AC-P55-3:** Retrieval von Originalen aus komprimierten Kontexten funktioniert E2E (Marker → Original), nachgewiesen durch Test.
- **AC-P55-4:** Code/Diffs/IDs/Fehlermeldungen werden durch Protect-Regeln nachweislich nicht verändert.
- **AC-P55-5:** Plugin-Ausfall verhält sich wie konfiguriert (Fail-open geloggt oder Fail-closed), ohne inkonsistenten Zustand; beide Toggle-Stellungen in E2E-Matrix.

## 6. Premortem (Failure-Modi + Mitigation)

- **Token-Zahlen schönhauen** (nur erfolgreiche Feuern zählen) → Skips/Fehler sind Pflichtfelder; 0-Beiträge sichtbar.
- **Zweite Stats-Wahrheit neben EventStore** → Plugin-Stats sind Events im EventStore, Aggregation abgeleitet (P56-Prinzip).
- **Qualitätsverlust unbemerkt** → Qualität bewusst außen vor, aber A/B-Empfehlung + Gates; Nutzer entscheidet (Doku + Settings-Hinweis).
- **Cache-Invalidierung frisst Ersparnis** → Cache-/Token-Modus als Option; Netto-Metriken in P56.

## 7. Definition of Done

Alle T55.* und AC-P55-* mit Evidenz; Retrieval-E2E-Test grün; Abnahme mit Nutzer (Settings-Demo mit echten Sparzahlen).
