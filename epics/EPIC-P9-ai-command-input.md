# EPIC-P9 — Alle Hub-Aktionen und Eingaben per AI

**Status:** Planungsentwurf, Umsetzung blockiert · **Phase:** P9 · **Dauer:** 1–2 Agenten-Wochen (grobe Schätzung) · **Abhängigkeit:** P8 grün; gemeinsame Policy und Operationen aus P7 verfügbar.

Planungsauftrag vom 2026-09-21; kein Umsetzungsstart und keine Behauptung eines
grünen Vorgänger-Gates. Scope, Evidenz und bestehende Restarbeiten:
[Audit](../docs/remote-control-audit-2026-09-21.md), [Index](README.md).

## 1. Ziel

Ein gemeinsamer Text-/AI-Einstieg bedient sämtliche registrierten Hub-Aktionen
und bearbeitbaren Felder: navigieren, suchen, starten, fortführen, Rückfragen
beantworten, konfigurieren und Arbeitsresultate prüfen. PRD G2, §6.3/§8,
K1/K4/K5/K7/K10; Audit G11/G13.

## 2. Scope (In / Out)

**In:** getypte Aktionspläne, Kontextauflösung, Entitäten, AI-Feldbearbeitung,
Vorlagen, lokale Modellkonfiguration, Parität UI/CLI/MCP/AI und Rückmeldungen.
**Out:** Spracherkennung (P10), universeller Desktop-Zugriff (P11), freie Shell,
Umgehen von Passkey/OS-Dialogen oder Provider-Policies.

## 3. Design-Details

Keine zweite Ausführungsengine: alle Eingabekanäle verwenden den registrierten
Operationskatalog aus P7. Planer liefert Daten mit Schema, IDs und Revisionen;
Server validiert Argumente, Actor, Capability und Policy. Agentenoutput/
Dateiinhalt bleibt untrusted Datenkontext und wird niemals Benutzerauftrag.

Kontext = aktiver Host/Projekt/Session/Feld, darf bei einem Hintergrundwechsel
nicht still umgebogen werden. Ambiguität („stoppe die Session“ ohne Auswahl)
erzeugt Auswahl/Rückfrage, keine geratenen IDs. Mehrschrittplan zeigt echte
Nebenwirkungen, Ausführung und Teilergebnisse; Neuplanung nach Zustandswechsel.

Diktat/Feldbearbeitung und Befehl explizit unterscheiden: „schreibe 'stopp' in
die Nachricht“ stoppt keinen Worker. AI kann alle fachlichen Felder füllen und
korrigieren; Credentials/Passkey-Nachweise werden nicht generiert oder an Modelle
gegeben. Original/Änderungsdiff/Undo bleiben verfügbar. Harmloses Navigieren ohne
Modal; schreibende Aktionen gemäß derselben konfigurierten Policy wie manuell.

Lokales Modell bevorzugt, Providerwahl und Datenfluss sichtbar. Kein implizites
Cloud-Fallback. Ein ausgefallenes Modell verhindert manuelle Hub-Nutzung nicht.
MCP bleibt lazy mit drei Meta-Tools; keine Aufnahme des Gesamtkatalogs in jeden
Prompt. Laya wird erst in P10 gegen diese Schnittstelle evaluiert.

## 4. Aufgaben

- [ ] **T9.1 — Aktions- und Input-Contract.** ADR für Plan/Operation/Context/Field-Edit; Katalog aller produktiven UI-Flows und editierbaren Felder, pro Eintrag AI-Pfad oder echte Nutzerinteraktion deklarieren. K4/K5/K7.
- [ ] **T9.2 — Planner und Kontextauflösung.** Lokalen Modellpfad anbinden; schema-validierte Pläne, Resolver für Host/Session/Projekt/Datei, Rückfragen bei Ambiguität, Dry-run-Vorschau. K1/K5.
- [ ] **T9.3 — Ausführung über bestehende APIs.** Registry/Policy aus P7 wiederverwenden; idempotente Plan-Schritte, Cancel, Timeout, Teilfehler, Audit samt Actor und Ergebnis. K1/K7/K10.
- [ ] **T9.4 — AI-Eingabe überall.** Gemeinsamer Composer und Cmd/Ctrl+K: Formular füllen, Text korrigieren/kürzen/übersetzen/verbessern, Original/Undo; lokale Optimierung mit Egress-Tests und Kosten-/Latenzanzeige bei optionalem Provider. K5/K10; PRD G2.
- [ ] **T9.5 — Parität und adversarielle Evaluation.** Alle UI-Aktionen mit natürlichen deutschen/englischen Varianten prüfen, fremden Session-Output als Angriffstext einspielen, Fehlklassifikation/Planfehler messen, keine Selbstfreigabe. K1/K4/K5/K7.

## 5. Acceptance Criteria

- **AC-P9-1:** Jeder Eintrag des UI-/Feldkatalogs hat einen erfolgreich getesteten AI-Flow; Passkey/OS-Zustimmung bleibt als Nutzerinteraktion benannt. Keine rein dekorative Command-Palette.
- **AC-P9-2:** ≥ 100 getrennte Testaufträge aus Nutzerformulierungen, inklusive Negation, mehreren ähnlich benannten Projekten und Korrekturen: ≥ 95 % korrekt erfüllt oder korrekt nachgefragt; null ungefragte riskante Aktionen im Testsatz.
- **AC-P9-3:** „Zeig wartende Sessions“, „Starte Codex in Projekt X“, „Antworte dort …“, „Fülle dieses Feld …“ funktionieren ohne manuelle Pfadeingabe; Zielwechsel nach Preview invalidiert den Plan.
- **AC-P9-4:** Injizierte Agent-Ausgabe kann keine Aktion/Freigabe auslösen; manipulierte Schemas, unbekannte IDs und abgelaufene Revisionen werden abgelehnt.
- **AC-P9-5:** Lokaler Modus mit gesperrtem externem Egress funktioniert; Modell-Ausfall hat klaren manuellen Fallback. Crash/Retry erzeugt keinen Doppelauftrag; K4/K5 bleiben grün.

## 6. Premortem

1. **AI bedient eine andere Session als gedacht:** Context-ID/Revision an Plan binden, sichtbares Ziel vor Write.
2. **„Alle Eingaben“ wird nur Prompt-Rewrite:** Feld-/Operationsinventar als blockierende Coverage-Matrix.
3. **Agententext wird zur Steueranweisung:** strikt getrennte Herkunft, typisierte Vorschläge, adversarielle Tests.
4. **Lange Modellantwort blockiert Bedienung:** abbrechbarer Planer, direkte manuelle Aktionen immer verfügbar.

## 7. Definition of Done

Alle ACs mit benannten Tests/Messläufen belegt, Vorgänger-Gate geschlossen;
`npm test`, `npm run lint`, `npm run typecheck` grün, PWA-Build bei UI-Änderungen,
Last-/Gerätetests gemäß AC. Contracts first; Adapter-/Event-/Worker-Änderungen
mit ADR. K5-Blob-Grenze, K7-Recovery, AdapterContext-Isolation und Fail-loud
nachgewiesen. Jede Funktion in Config, API/CLI und passender UI tatsächlich
registriert/erreichbar; Capability-/Support-Matrix ehrlich aktualisiert.
Premortem im Abschlussreview gegenprüfen, offene Pflicht-ACs blockieren Abschluss.
Commit/MR gemäß Repo-Workflow; kein lokaler Merge nach main.
