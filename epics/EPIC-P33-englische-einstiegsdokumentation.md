# EPIC-P33 — Englische Einstiegsdokumentation und OSS-Bereitschaft

**Status:** Planungsentwurf · **Umsetzung:** gesperrt · **Phase:** P33
**Dauer:** 0,5–1,5 Agenten-Wochen (ohne Vorgänger-Restarbeit)
**Abhängigkeit:** P32-Evaluations-Exit explizit abgenommen; bei Go auch Implementierungs-Exit grün, sonst Vertagung dokumentiert.

Quelle: [Vergleichsanalyse vom 05.11.2026](../docs/2026-11-05_paseo-vs-ancientvoid.md), §5; [Planungsgrundlage und Quellen](../docs/2026-11-05_paseo-umsetzungsplanung.md).

**Planungsauftrag:** Der Nutzer hat am 05.11.2026 ausdrücklich detaillierte
Epics zu den Verbesserungen der Paseo-Analyse beauftragt. Das erlaubt diese
Planung vor grünen Vorgängern, aber keinen Implementierungsstart. Vor T*.1
Vorgänger-AC mit aktueller Code-/Test-Evidenz prüfen; historische Statuszeilen
reichen nicht. Keine neue Ausnahme von AGENTS.md durch diesen Entwurf.

## 1. Ziel

Ein englischsprachiger Leser kann AncientVoid sicher lokal starten und einen
Adapter oder Sink über stabile Contracts anbinden. Eine Veröffentlichung bleibt
eine eigene Entscheidung; verständliche Dokumentation behauptet keine bisher
ungeprüfte Provider-/Geräteunterstützung. K5/K7/K8 und PRD §9 verankern die
Integrationsbeispiele, keine neue Produktfunktion nur für Übersetzungen.

## 2. Scope (In / Out)

**In:** Bedarfsentscheid, englische README und Contracts-/Contributor-Einstieg,
Sicherheits-/Capability-Grenzen, getesteter Quickstart, Konsistenzregeln und
OSS-Readiness-Checkliste mit vorhandener P4-Restarbeit verknüpft.

**Out:** automatisches Public-Schalten, Veröffentlichung von Daten/Artefakten,
Übersetzung aller ADRs, Marketing-Website oder Community-/Registry-Betrieb.
P4-OSS-Aufgaben nicht ein zweites Mal als erledigt zählen.

## 3. Design-Details

### 3.1 Bedarfsentscheid und Quellen

Vor Umsetzung klären: englischer interner Einstieg jetzt erwünscht oder erst
bei externer Zusammenarbeit? Entscheidung mit Nutzer festhalten. Bei Vertagung
nur Evaluations-Exit, keine angeblich fertige Doku. Deutsch bleibt historische
ADR-/Epic-Sprache. Vorschlag `README.en.md` am Root als README-Variante,
Detailseite `docs/contracts.en.md` (flach); keine neuen Status-/Summary-Dateien.

### 3.2 Inhalte am Code prüfen

Quickstart: tatsächliche unterstützte Node-Version/strip-types-Verfügbarkeit,
`npm ci`, PWA-Build, lokaler Hub mit isoliertem Datadir, explizite Projektwurzeln,
Pairing/Tailscale, Shutdown. Mindestversion nicht blind aus package.json
übernehmen, wenn strip-types zusätzliche Flags verlangt. Kein produktives
`hub.config.json`, kein Token in Beispielen. Public API aus aktuellem
`packages/contracts/src/index.ts` und Modul-Exports, nicht alten ADR-Pfaden.

Contracts-Übersicht erklärt AdapterContext, Factory, Events ≤4 KB/Blob (K5),
JSONL+Snapshot/Resume (K7), Worker-Ownership, Capability-Testkit und K8-Lasttest.
Ein installierbarer P30-Adapter und ein opt-in-Sink dienen als Beispiele.
P31-Matrix unterscheidet vorhanden, getestet, proven und unsupported je Funktion;
keine aus der Vergleichsanalyse übernommenen, zeitabhängigen Zahlen als Garantie.

### 3.3 Pflege und Veröffentlichung

Bestehende deutsche Einstiege und englische Fassung verlinken einander;
welche Seite für welchen Inhalt maßgeblich ist, direkt benennen. Bei Contract-
Änderung aktualisiert dieselbe MR relevante Beispiele und beide Einstiege.
Link-/Beispielprüfung wiederverwenden oder klein halten; kein eigenes Doc-System.

OSS-Checkliste referenziert P4/P12: Lizenz-/Abhängigkeitsprüfung, Secretscan,
Fixtures ohne Roh-Logs, Supportgrenzen und reale Abnahmen. Unfertige Punkte
bleiben unter Original-IDs. Repo/Registry/App-Store-Publikation erst nach
separater ausdrücklicher Nutzerentscheidung, kein Nebeneffekt von Dokuarbeit.

## 4. Aufgaben (Checkliste T33.m)

- [ ] **T33.1** Bedarf und englischen Mindestumfang mit Nutzer entscheiden;
  P4/P12-Restarbeit referenzieren, Abschluss Evaluation vs. Lieferung
  kennzeichnen. **K5/K7/K8**, PRD §9.
- [ ] **T33.2 (bei Go)** README.en.md/Quickstart gegen frisches temporäres
  Datadir ausführen; Link aus deutscher README. Node-Version und alle
  tatsächlich nötigen Befehle protokollieren. **K7/K10**.
- [ ] **T33.3 (bei Go)** Contracts-/Contributor-Einstieg anhand aktueller
  Exports und P30/P31-Beispiele schreiben; Adapter-Testkit, K5-Grenze,
  Recovery und Unsupported-Verhalten praktisch prüfen. **K5/K7/K8**.
- [ ] **T33.4 (bei Go)** Sicherheits-/Supportgrenzen und OSS-Checkliste mit
  P4-IDs ergänzen, tote Links/alte Paketnamen prüfen; Pflegeverantwortung
  bei Änderungen in CONTRIBUTING verankern. **K1/K5/K7**, PRD §8.5/§9.

## 5. Acceptance Criteria (AC-P33-k)

- **AC-P33-1:** Nutzerentscheid und P4-Abgleich vorhanden; Vertagung bleibt
  als Evaluations-Exit ohne ausgelieferte Übersetzung ausgewiesen.
- **AC-P33-2 (bei Go):** Quickstart im frischen Checkout mit Test-Datadir
  ausgeführt, lokale Hub/PWA erreichbar, kein Produktionskonfigzugriff nötig.
- **AC-P33-3 (bei Go):** Beispieladapter/Sink über dokumentierten Pfad nutzbar;
  aktuelle Contract-Exports, K5/K7 und ehrliche P31-Capabilities erklärt,
  Links auf existierende Dateien/Abschnitte gültig.
- **AC-P33-4 (bei Go):** Zweisprachige Einstiege auffindbar, Pflegeweg benannt;
  keine Secrets/Roh-Logs oder ungeprüften Public-/Release-Claims ergänzt.

## 6. Premortem (Failure-Modi + Mitigation)

1. **Übersetzung konserviert veraltete Pfade:** Beispiele gegen aktuelle Exports
   und frisches Checkout ausführen, historische ADRs nur als Hintergrund.
2. **Zwei READMEs widersprechen sich:** Verantwortlichkeit pro Inhalt benennen,
   Contract-MR aktualisiert beide relevanten Einstiege.
3. **OSS-Checkliste wird als Freigabe missverstanden:** Veröffentlichung separat,
   offene P4/P12-Abnahmen mit Original-IDs sichtbar.
4. **Quickstart leakt lokale Konfiguration:** vollständig synthetische Beispiele
   und temporäres Datadir, hinzugefügte Zeilen auf Secrets prüfen.

## 7. Definition of Done

Evaluations-Exit oder alle Go-Aufgaben/AC belegt; Links und Quickstart geprüft,
keine ungefragte Publikation. Vor Commit Tests/Lint/Typecheck grün. Bei
Implementierungsabschluss `npm run gate` grün, Pipeline-Job `e2e` grün bzw.
Infrastrukturfehler nach AGENTS.md separat bewertet. Jede neue UI-Funktion/
jeder Ablauf hat einen Spec in `e2e/specs/`; bestehende Abläufe nur dokumentiert,
keine sinnlosen UI-Tests für übersetzte Prosa. Englischer Einstieg aus README
und CONTRIBUTING erreichbar; offene OSS-Arbeit nicht als erledigt markiert.
