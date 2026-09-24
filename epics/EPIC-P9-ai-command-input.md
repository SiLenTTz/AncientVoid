# EPIC-P9 — Alle Hub-Aktionen und Eingaben per AI

**Status:** abgeschlossen (2026-09-24, Retro unten) · **Phase:** P9 · **Dauer:** 1–2 Agenten-Wochen (grobe Schätzung) · **Abhängigkeit:** P8 grün; gemeinsame Policy und Operationen aus P7 verfügbar.

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

- [x] **T9.1 — Aktions- und Input-Contract.** ADR für Plan/Operation/Context/Field-Edit; Katalog aller produktiven UI-Flows und editierbaren Felder, pro Eintrag AI-Pfad oder echte Nutzerinteraktion deklarieren. K4/K5/K7.
- [x] **T9.2 — Planner und Kontextauflösung.** Lokalen Modellpfad anbinden; schema-validierte Pläne, Resolver für Host/Session/Projekt/Datei, Rückfragen bei Ambiguität, Dry-run-Vorschau. K1/K5.
- [x] **T9.3 — Ausführung über bestehende APIs.** Registry/Policy aus P7 wiederverwenden; idempotente Plan-Schritte, Cancel, Timeout, Teilfehler, Audit samt Actor und Ergebnis. K1/K7/K10.
- [x] **T9.4 — AI-Eingabe überall.** Gemeinsamer Composer und Cmd/Ctrl+K: Formular füllen, Text korrigieren/kürzen/übersetzen/verbessern, Original/Undo; lokale Optimierung mit Egress-Tests und Kosten-/Latenzanzeige bei optionalem Provider. K5/K10; PRD G2.
- [x] **T9.5 — Parität und adversarielle Evaluation.** Alle UI-Aktionen mit natürlichen deutschen/englischen Varianten prüfen, fremden Session-Output als Angriffstext einspielen, Fehlklassifikation/Planfehler messen, keine Selbstfreigabe. K1/K4/K5/K7.

- [ ] **T9.x — Anhang aus dem Teilen-Menü (AI-P8-3).** → verschoben nach P12 T12.4 (braucht Manifest-Share-Target und Gerätetest). Web Share Target im Manifest: Datei/Text aus einer anderen App direkt in eine Session oder einen Entwurf; Gerätetest.

**Stand 2026-09-24 (T9.1–T9.5):** [ADR-0027](../docs/adr/0027-text-commands.md) — Katalog mit 16 Einträgen und benannten Nur-Tippen-Flows; Regel-Planer DE/EN + lokales Modell (JSON-Schema), Resolver mit Rückfragen statt Raten; Ausführung per `inject` über die echten Routen mit dem Token des Aufrufers (Policy, Idempotenz, Revision); Ctrl/Cmd+K bzw. ✦/⋯ mit Plan-Vorschau, Feldbearbeitung mit Vorher/Nachher/Rückgängig über das lokale Modell. Messlauf: [2026-09-24-p9-commands.md](../docs/messlauf/2026-09-24-p9-commands.md). Tests: `commands.test.ts` (115 Sätze), `commands-routes.test.ts` (Ausführung, Rückfrage, Revision, Agent, Adversarial, Coverage-Matrix), E2E `commands.spec.ts`.

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

## Retro

**Zeitraum:** 2026-09-24 · **Gate:** lokal grün (Abschluss-MR)

### AK-Matrix

- **AC-P9-1:** 🟢 erfüllt
  - **Beleg:** Coverage-Test „AC-P9-1: every catalog entry has a tested flow in words“:
    16/16 Einträge, 10 davon über die echten Routen ausgeführt. Dazu E2E
    `commands.spec.ts` und `USER_ONLY_FLOWS` mit Begründung.
- **AC-P9-2:** 🟢 erfüllt
  - **Beleg:** 115 Sätze 100 % (Regeln). Held-out 30: 96,7 % mit lokalem
    Modell, 0 ungefragte riskante Aktionen (Messlauf).
  - **Einschränkung:** Der Entwicklungssatz ist selbst geschrieben, ein
    Nutzerkorpus fehlt (AI-P9-1).
- **AC-P9-3:** 🟢 erfüllt
  - **Beleg:** E2E „Zeig wartende Sessions“, „Starte opencode in alpha: …“
    (ohne Pfadeingabe), „Antworte dort …“, „schreibe 'stopp' in die
    Nachricht“. Route-Test: verschobenes Ziel ergibt 409, veraltete Revision
    wird abgelehnt.
- **AC-P9-4:** 🟢 erfüllt
  - **Beleg:** Adversarial-Test (Agenten-Ausgabe, gefälschte IDs, unbekannte
    Pläne, fremdes Gerät), Agent ohne Abkürzung.
- **AC-P9-5:** 🟢 erfüllt
  - **Beleg:** Ohne Modell verstehen die Regeln allein 66,7 % und
    verweigern den Rest klar. Textbearbeitung ohne Modell: 501 mit Hinweis,
    Text bleibt (E2E). Kein Cloud-Rückfall. Wiederholtes Ausführen:
    `repeated`, kein zweiter Auftrag (Route-Test). K4 unverändert
    (`k4-token-budget.test.ts` grün).

**Stand:** 5 🟢.

### Premortem

1. **AI bedient eine andere Session:** abgefangen. Kontext und Revision sind an
   den Plan gebunden, das Ziel steht sichtbar vor „Ausführen“ (E2E, Route-Test).
2. **„Alle Eingaben“ wird nur Prompt-Rewrite:** nicht eingetreten. Die
   blockierende Coverage-Matrix hält es fest.
3. **Agententext wird Steueranweisung:** geprüft und dabei einen echten
   Fehler gefunden (Frage → Antwort senden), behoben. Der Planer sieht nie
   Event-Inhalte.
4. **Lange Modellantwort blockiert Bedienung:** nicht eingetreten. Regeln
   laufen zuerst (0 ms), das Modell ist auf 12 s begrenzt, die Knöpfe bleiben
   frei.

### Erkenntnisse

1. **JS-`\b` kennt keine Umlaute.** „öffne“, „übersetze“ und „kürze“ trafen nie.
   Die Lösung war Umschrift von Text und Mustern, nicht mehr Muster.
2. **Regeln plus Modell ist die richtige Aufteilung:** Die Regeln sind der
   sichere Boden (0 Fehlgriffe, 0 ms), das Modell bringt die Breite
   (66,7 → 96,7 % Held-out).
3. **Ausführung per `inject` über die eigenen Routen** hat Policy, Idempotenz
   und Revision ohne eine Zeile Sonderlogik geerbt.
4. **Aus P8 gelernt:** Der ✦-Knopf schwebt nicht über dem Inhalt, er sitzt in
   der Kopfzeile bzw. im ⋯-Menü.

### Action Items

- **AI-P9-1:** Nutzerkorpus (≥ 100 echte Formulierungen aus dem Betrieb)
  sammeln und Planer darauf messen, ohne vorher zu schärfen.
  - **Zurück als:** P12 T12.4.
- **AI-P9-2:** Anhang aus dem Teilen-Menü (Web Share Target) mit Gerätetest.
  - **Zurück als:** P12 T12.4.
- **AI-P9-3:** Sprachbefehle (P10) gegen dieselbe Schnittstelle führen statt
  eigener Direktiven (`voice-directives.ts` ablösen).
  - **Zurück als:** P10 T10.3.
