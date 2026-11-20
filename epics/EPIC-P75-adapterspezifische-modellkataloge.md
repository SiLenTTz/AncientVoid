# EPIC-P75 — Aktuelle, adapterspezifische Modellkataloge

**Status:** Planungsentwurf (20.11.2026), Umsetzung gesperrt · **Phase:** P75 · **Dauer:** 1–2 Agenten-Wochen · **Tracker:** noch nicht angelegt
**Abhängigkeit:** [P74](EPIC-P74-knowledge-mcp-brick.md) ist offen; dessen Exit-Kriterien vor Implementierungsstart mit aktueller Evidenz prüfen. Fachliche Basis: P15/P35, ADR-0018/0054/0060/0061. Der ausdrückliche Auftrag erlaubt diesen Entwurf vor grünem Vorgänger, keine Umsetzung oder neue Gating-Ausnahme. P30/P31 bleiben On hold und werden nicht vorausgesetzt oder reaktiviert.

## 1. Ziel

Startformular, Modellwechsel und Übergabe zeigen die Modelle, die der gewählte
Adapter mit seiner konkreten Registrierung tatsächlich anbietet. Neue Modelle
erscheinen ohne PWA-Release, soweit eine native Quelle sie liefert. Die Oberfläche
unterscheidet „angeboten“, „manuell eingetragen“ und „nicht aktuell prüfbar“.
Ein Katalogeintrag garantiert weder Kontingent noch einen erfolgreichen Modellaufruf.
Bezug: PRD §9 K5/K7/K10; Fehler sichtbar nach Architekturregel „Fail loud“.

## 2. Scope (In / Out)

**In:** Quelleninventar aller registrierbaren Adapter, versionsgebundene Parser,
Aktualisierung/Cache-Invalidierung je Registrierung, sichtbare Fehler und Fallbacks,
gleiche Auswahllogik für Start/Wechsel/Übergabe, Regressionen und Bedienhinweise.

**Out:** globaler Provider-Marktplatz (P31), Plugin-Installation (P30), automatische
Modellmigration laufender Sessions, Provider-Anmeldung, kostenpflichtige Testprompts,
Preisvergleichsprodukt oder vollständige Erneuerung aller Preis-/Kontexttabellen.
Keine Modellfreischaltung allein anhand einer öffentlichen API-Modellliste.

## 3. Design-Details

### 3.1 Belegter Bestand — Repository-Sichtung 20.11.2026

Die Tabelle beschreibt den Code, keine neu durchgeführte Live-Provider-Abnahme.
Quellen: jeweilige `packages/adapters/<adapter>/src/index.ts`, ergänzend unten.

| Adapter/Pfad | Quelle heute | Grenze / geplante Behandlung |
|---|---|---|
| Codex app-server | `app-server.ts:listModels`, kurzlebiger Prozess, `model/list`, versteckte Einträge herausgefiltert, 20-s-Limit | Keine harte Modellliste; aktuelle Implementierung liest nur `data` eines Aufrufs. Pagination/Schema anhand installierter CLI verifizieren und vollständig abarbeiten, falls angeboten. |
| Codex exec | `modelsCommand`, sonst `[]` | Keine native Auflistung implementiert. App-server-Probe nur nach Nachweis gleicher Anmeldung/Provider-Konfiguration; sonst freie Eingabe als ungeprüft. |
| Claude | `modelsCommand`, sonst **hartcodiert** `fable`, `opus`, `sonnet`, `haiku` | Aliase sind kein aktueller Account-Katalog. Native, dokumentierte Discovery prüfen; ohne sie nur ausdrücklich kuratierter Fallback. |
| OpenCode | `modelsCommand`, sonst `<command> models` | CLI-Katalog kann Modelle ohne nutzbare Anmeldung enthalten; Quelle/Prüftiefe deklarieren, keine Nutzbarkeitsgarantie. |
| pi | `modelsCommand`, sonst `--list-models`, Tabellenparser | Code dokumentiert Filter auf angemeldete Provider; CLI-Version/Format in Fixtures absichern. |
| Cursor | `--list-models`, Parser `id - label` | Unbekanntes nichtleeres Ausgabeformat kann heute leer aussehen; künftig Formatfehler sichtbar. |
| Hermes / Copilot CLI | `modelsCommand`, sonst `[]` | Kein eigener Live-Katalog; konfigurierbare Quelle oder ehrlicher manueller Modus. Copilot CLI nicht mit Copilot ACP gleichsetzen. |
| ACP | explizites `modelsCommand`; dsh/maki/omp über ACP-Probe; sonst aus abschließendem `acp` abgeleitetes `models`-Kommando | Zusätzlich sessiongebundene `configOptions`/`availableModels` bei new/load; diese bleiben für tatsächliche Auswahl maßgeblich. Copilot-Preset meldet `modelChoice: none`. |
| aider / JSON-RPC / Clip- und Loop-Pfade | keine gemeinsame Katalogzusage | In T75.1 jedes Paket/Registrierungsprofil zuordnen: unterstützt, manuell oder keine Auswahl; keine erfundene Discovery für Monitor-only. |

`apps/hub/src/modules/harness/harness.routes.ts` cached je Registrierungs-ID
zehn Minuten im Speicher. Fehler werden geloggt, die Antwort enthält dann
`models: null`; kein Fehlerstatus und kein letzter erfolgreicher Katalog werden
zurückgegeben. `CustomModelStore` mischt eigene Einträge hinzu (`customIds`);
ein eigener Eintrag ist kein Provider-Nachweis. Neue pi-Provider invalidieren
bereits den Cache. Weitere Invalidierungswege sind zu inventarisieren.

`CreateSession.tsx` fällt bei Fehler auf `null` zurück; `SessionConfigure.tsx`
behält die vorige Liste, verschweigt aber den Lesefehler; `Handover.tsx` ignoriert
Katalogfehler. Das verhindert eine einheitliche Aussage zur Aktualität.

Weitere **statische Daten, keine Verfügbarkeitslisten**:
`packages/models/src/index.ts:RULES` enthält kuratierte Kontextfenster mit
Substring-Matching (u. a. breit `gpt-6`); `codex/src/pricing.ts:CODEX_PRICING`
enthält nur `gpt-5.3-codex`. Unbekannte Preise bleiben unbekannt. Diese Tabellen
dürfen weder neue Modelle ausschließen noch deren Verfügbarkeit oder Preis erfinden.
Fixtures und Konfigurationsdefaults sind ebenfalls keine Discovery-Quelle.

### 3.2 „Kolex“, Modell 6.2 und Preisprüfung

**Offene Identität:** Im durchsuchten Repository kein Treffer für „Kolex“.
Arbeitsannahme: gemeint ist OpenAI **Codex** (`codex`, exec/app-server).
Eine Rückfrage wurde gestellt; ohne Bestätigung bleibt diese Zuordnung unbestätigt.
T75.1 muss sie vor adapterspezifischer Umsetzung klären; kein neuer Adaptername.

**Öffentlich belegt, abgerufen 20.11.2026:**
[OpenAI-Modellseite](https://developers.openai.com/api/docs/models/gpt-6.2-sol)
führt `gpt-6.2-sol`;
[OpenAI Learn](https://learn.chatgpt.com/docs/pricing) nennt GPT-6.2 Astra/Sol
auch für Codex App/CLI und bezahlte Pläne. Das belegt Produktverfügbarkeit,
keinen Zugriff einer bestimmten AncientVoid-Registrierung.

[Offizielle API-Preise](https://developers.openai.com/api/docs/pricing),
USD je Million Tokens, Standard / kurzer Kontext:

| Modell | Input | Cached Input | Output |
|---|---:|---:|---:|
| `gpt-6.1-sol` | 2,00 | 0,10 | 10,00 |
| `gpt-6.2-sol` | 2,00 | 0,10 | 10,00 |
| `gpt-6-astra` | 10,00 | 1,00 | 50,00 |
| `gpt-6.2-astra` | 8,00 | 0,40 | 40,00 |

**Schluss:** Sol 6.2 ist pro Token nicht günstiger als Sol 6.1. Astra 6.2
ist gegenüber Astra 6 günstiger (20 % Input/Output, 60 % Cached Input);
das ist kein Vergleich zu „6.1“ insgesamt. Effizienz pro Aufgabe, Abokontingente,
Langkontext und andere Geschwindigkeiten sind gesondert zu messen/prüfen.
Keine Sparbehauptung oder Vorbelegung von 6.2 im Produkt ohne passende Evidenz.

### 3.3 Zielablauf und Contracts first

1. UI lädt den Katalog der ausgewählten Host-/Adapterregistrierung. Native
   Harness-/Sessionquelle gewinnt; öffentliche Provider-Listen sind höchstens
   Zusatzmetadaten. Insbesondere API-Key-Zugriff und Codex-Abo nicht gleichsetzen.
2. Geplanter gemeinsamer Katalog-Contract in `packages/contracts/src/harness/`:
   Herkunft/Prüftiefe, `observedAt` (letzter Erfolg), `attemptedAt`, Zustand
   `fresh | stale | error | unsupported | empty`, kompakter Fehlercode,
   getrennte manuelle Einträge. Migration von `models(): ModelOption[]` und
   bestehender HTTP-Antwort per ADR festlegen, keine lokalen PWA-Duplikattypen.
3. Cache-/Refresh-Fachlogik in `core/src/modules/`, Route dünn. Schlüssel enthält
   Host, Registrierungs-ID und Konfigurationsgeneration; Auth-/Providerwechsel,
   Re-Registrierung und Custom-Änderungen invalidieren. Keine Secrets im Schlüssel.
4. Vorgeschlagene Defaults: TTL 10 min, aktive Aktualisierung beim Öffnen nach
   Ablauf und per „Aktualisieren“, ein laufender Abruf pro Schlüssel, Deadline
   20 s inkl. aller Seiten, Größen-/Seitenlimit mit sichtbarem `truncated`.
   Fehler-Retry frühestens nach 30 s; manuelles Refresh ebenfalls begrenzt.
   Kein globaler Poller, keine Inferenz zum Ermitteln von Modellen. ACP-Probes
   können native Sessions erzeugen: Kostenfreiheit und Cleanup separat belegen.
5. Bei Fehler bleibt letzter Erfolg mit Zeitstempel und Grund sichtbar (`stale`).
   Ohne Erfolg: `error`, kein vorgetäuschter leerer Provider-Katalog. Erfolgreich
   leere Liste ist `empty`, fehlende Fähigkeit `unsupported`; Schemaabweichung
   ist Fehler. Kuratierte/manuelle Fallbacks klar markieren und nur anbieten,
   wenn `modelChoice` es erlaubt. Kein stiller Wechsel auf ein anderes Modell.
6. Ein ausgewähltes/aktives, inzwischen fehlendes Modell bleibt sichtbar mit
   Warnung; neue Auswahl und Start-/Wechsel-Ack getrennt behandeln. Native
   Ablehnung erhält die Session-Konfiguration; bei Resume gilt ADR-0061.

Adapter erhalten weiterhin ausschließlich `AdapterContext`; Discovery liegt im
Adapter bzw. vorhandener Hilfsbibliothek, ohne Core-/Hub-Imports. Für Probe-Auth
keine Hub-Internas einschleusen. Jede Contract-Änderung braucht ein ADR.
Kataloge über begrenzte HTTP-Antworten, nie vollständig in Adapter-Events;
Diagnoseevents ≤ 4 KB, größere Belege über `ctx.blob()` (K5).
Cache bleibt wegwerfbar: nach Restart unbekannt bis Discovery, keine Änderung
von Session.model; autoritativer Sessionzustand aus JSONL+Snapshot (K7).
Offline zeigt die PWA letzte Projektion/Zeitstempel, keine frische Bestätigung (K10).

## 4. Aufgaben (Checkliste T75.n)

- [ ] **T75.1 — Inventar und Identität.** Alle Pakete/Registrierungen inklusive ACP-Presets, Custom-/Endpoint-Quellen, Auswahlfähigkeiten und CLI-Versionen erfassen; „Kolex“ bestätigen, Discovery/Preis/Metadaten trennen; vorher P74-Exit prüfen. K5/K7, PRD §9.
- [ ] **T75.2 — Contract/ADR.** Statusmodell, Zeitstempel, Limits, Cache-Identität, Rückwärtskompatibilität und Recovery-Verhalten entscheiden; Ablauf ohne native Liste explizit. K5/K7/K10.
- [ ] **T75.3 — Adapterquellen.** Native Discovery priorisieren, Pagination/Timeout/Prozessende/Parserfehler absichern; keine Liste für nicht unterstützte Auswahl erfinden; Claude-Fallback kennzeichnen. K5, Fail loud.
- [ ] **T75.4 — Hub-Aktualisierung.** Single-flight, TTL, Invalidierung, letzter Erfolg und Retrygrenzen umsetzen; Config-/Auth-Wechsel ohne Datenübernahme. K7/K10.
- [ ] **T75.5 — Einheitliche UI.** Start, Wechsel, Übergabe: Quelle/Alter/Fehler, Refresh, manuelle IDs, entfernte Auswahl, abgelehnter Wechsel und offline konsistent darstellen. K10, K2-Regression.
- [ ] **T75.6 — Nachweise und Dokumentation.** Gezielte Tests unten rot-dann-grün, Bedienhinweise zu Aliassen/Anmeldung/Preisen; reale Account-Abnahmen bei Bedarf nach P000 delegieren. K5/K7/K10.

## 5. Acceptance Criteria (AC-P75-k)

1. **AC-P75-1:** Inventar umfasst jede Adapterimplementierung und Registrierungsklasse mit Quelle, Fallback und Fähigkeitsgrenze; Codex/„Kolex“-Zuordnung bestätigt oder ausdrücklich offen/blockierend für betroffene Umsetzung. Keine ungeprüfte Gleichsetzung.
2. **AC-P75-2:** Fixture ergänzt ein neu angebotenes Modell (z. B. `gpt-6.2-sol`): nach Refresh in Start/Wechsel/Übergabe sichtbar, ausschließlich bei passenden Fähigkeiten; ohne PWA-Neubau und ohne Änderung von Session.model.
3. **AC-P75-3:** Tests unterscheiden Erfolg-leer, unsupported, Timeout, Authfehler, unbekanntes Format und Teilkatalog. Stale behält Erfolgszeitpunkt; ohne Vorwert sichtbarer Fehler. Kein stiller Default-/Modellwechsel.
4. **AC-P75-4:** Gleichzeitige Anfragen lösen genau eine Probe aus; TTL/Retry mit Fake-Clock geprüft. Configwechsel und zwei Hosts mit gleicher Adapter-ID mischen keine Kataloge. Pagination liefert alles oder explizit begrenztes Ergebnis.
5. **AC-P75-5:** Entferntes aktuelles Modell bleibt erkennbar; abgelehnter Wechsel ändert keinen autoritativen Zustand. Restart rekonstruiert dieselbe Session aus JSONL+Snapshot innerhalb K7 (< 3 s); Cacheverlust ist unschädlich. K5-Grenzfall > 4 KB und K10-Offline-Fall automatisiert belegt.
6. **AC-P75-6:** Preisaussage bleibt exakt auf Modell/Tier/Datum begrenzt; kein „6.2 günstiger als 6.1“-Claim und keine Garantie aus öffentlicher Verfügbarkeit. Alle drei UI-Pfade besitzen benannte E2E-Nachweise.

**Teststrategie:** `packages/adapters/codex/test/app-server.test.ts`,
`packages/adapters/codex/test/adapter.test.ts` und betroffene
`packages/adapters/<name>/test/adapter.test.ts` mit anonymisierten Quellenfixtures;
Parserfälle in `packages/models/test/`; neue gezielte Route-Datei
`apps/hub/test/modules/harness/model-catalog.test.ts` (geplant) für Cache/Fehler;
Recovery-Fall im Session-Modul. E2E: bestehende `harness.spec.ts`,
`modus-modell.spec.ts`, `modell-wechsel-acp.spec.ts`, `custom-models.spec.ts`
unter `e2e/specs/` gezielt erweitern (inklusive Übergabe).
Keine kostenpflichtigen Live-Aufrufe in CI, übersprungene Provider-Abnahme ist kein Pass.

## 6. Premortem (Failure-Modi + Mitigation)

| Failure-Modus | Frühes Signal | Mitigation / Nachweis |
|---|---|---|
| Öffentliche Liste zeigt Modell ohne Accountzugriff | 403 trotz Dropdown-Eintrag | Herkunft/Prüftiefe; native Quelle vor globaler Liste; Ablehnungstest ohne Konfigurationsänderung. |
| CLI-Upgrade ändert Tabellen/Seitenstruktur | Nichtleere Ausgabe wird zu null Modellen | Versionierte Fixtures, Schemafehler statt leer, letzter Erfolg sichtbar stale. |
| Refresh-Sturm startet viele CLI-/ACP-Prozesse | steigende Prozesszahl, verwaiste Probe-Sessions | Single-flight, Deadline, begrenztes Retry, Cleanup auf Erfolg/Fehler/Abbruch testen. |
| Alter Cache überlebt neue Provideranmeldung | fremde Modelle nach Configwechsel | Generation im Cache-Schlüssel, gezielte Invalidierung und Host-Trennung. |
| Neue Modell-ID bekommt alten Preis/Kontext | pauschaler Prefix-Treffer | Metadatentabellen nicht als Verfügbarkeit verwenden; unbekannte Preise nicht extrapolieren; separate Pflegeaufgabe statt impliziter Vollzusage. |

## 7. Definition of Done

Alle AC mit Datei-/Testbeleg, Contract-ADR und erreichbarer UI; Tracker-Issue in
Statuszeile nachtragen, Defekt-PRs mit `Fixes #`, Epic-Issues vor Abschluss sichten.
Gezielte Tests rot-dann-grün, Lint/Typecheck grün; jede UI-Funktion/jeder Ablauf
mit Spec in `e2e/specs/`. Vor Epic-Abschluss `npm run gate` lokal grün auf
ausdrücklichen Auftrag; GitHub `verify` auf Abschluss-PR und volle K8-/E2E-Evidenz
gemäß aktuellem `docs/ci-runbook.md` (Nightly). Umgebungsrot/Skips nie als Pass.
Reine Menschen-Restabnahmen mit konkretem Ablauf nach
[P000](EPIC-000-testsuite-fuer-menschen.md) verschieben und hier „nach P000 verschoben“
vermerken; offene Agentenarbeit/Identitätsentscheidung blockiert weiterhin.
