# EPIC-P41 — Automationen mit Zeitplan, Precheck und Laufhistorie

**Status:** teilweise umgesetzt, Exit offen · **Umsetzung:** laufend · **Phase:** P41
**Dauer:** 2–3 Agenten-Wochen (grobe Schätzung, ohne Vorgänger-Restarbeit)
**Abhängigkeit:** P40 mit nachweislich grünen Exit-Kriterien; wirksame Vorgänger-Abnahmen bleiben bindend.

Quelle: [Orca-Vergleich](../docs/2026-11-08_orca-vs-ancientvoid.md) und [Planungsgrundlage mit Übernahmeregister](../docs/2026-11-08_orca-epic-planung.md).
**Planungsauftrag 08.11.2026:** Nutzer beauftragt diese Epics ausdrücklich vor Abschluss der Vorgänger. Das erlaubt Planung, keine Implementierung und keine Aufhebung des Epic-Gatings. Vor T41.1 aktuellen Code-/Test-/Abnahmestand prüfen; historische Überschriften reichen nicht.

## 1. Ziel

Wiederkehrende Aufträge in AV planen, gezielt starten und ihre tatsächlichen Ergebnisse verfolgen. Zeitpläne starten bestehende Sessions oder P40-Runs, ohne zweite Ausführungsengine. K1/K5/K7/K8/K10.

## 2. Scope (In / Out)

**In:** Stunden-/Tages-/Wochen-/Werktags-Presets und begrenztes 5-Feld-Cron, IANA-Zeitzone, Vorschau nächster Termine, enable/disable/run-now, registrierter Precheck, Historie, Offline-/Missed-/Restart-Regeln.
**Out:** beliebige Shell-Eingabe vom Handy, ungefragtes Nachholen aller verpassten Läufe, extern bereits geschedulte Factory erneut planen, vollständiger RRULE-Standard, implizite Modell-/Permission-Ersetzung.

## 3. Design-Details

### 3.1 Ausführung wiederverwenden
Bestand P40/LoopConnector/registrierte Aktionen/Workspace-Runtime prüfen. Neues `automations`-Modul besitzt Termine und Startaufträge, Session-/Run-Manager besitzt Ausführung. Ein Schedule hat feste Host-ID/Eigentümergeneration, Projekt, Arbeitsort (Worktree Standard), Harness/Modell oder vorhandene Run-Vorlage, Prompt-Blob und genehmigten Ausführungsrahmen. Vorhandene externe Zeitpläne nur lesen/verlinken oder explizit übernehmen, nicht doppelt ausführen. Direct-Checkout unterliegt P38-Lease; bei Konflikt sichtbarer Skip, kein heimlicher Wechsel.

### 3.2 Kalender und Zustände
UTC-Zeitstempel speichern; IANA-Zeitzone und Calendar-Ausdruck gesondert. Präzise DST-Regel: ungültige Lokalzeit überspringen, doppelte Lokalzeit einmal; Vorschau zeigt UTC/Ortszeit. Tests mit kontrollierter Uhr, Europe/Berlin und anderer Zone. Expliziter Dedupe-Key aus Schedule-ID+Generation+Occurrence, atomare Claim-Operation mit Recovery-Journal; `dispatched` heißt nicht `succeeded`. Unklarer Start bleibt unklar, kein blindes Replay. Scheduler liegt auf Ausführungshost, Fleet aggregiert nur; Failover nicht im MVP.

### 3.3 Bedienung und Befugnisse
Neu zunächst deaktiviert, Mensch sieht Ziel/Plan/Precheck/Arbeitsort/Permissions und aktiviert. `run-now` erhält eigene Operation, führt den Precheck standardmäßig ebenfalls aus; eine spätere Bypass-Aktion wäre gesondert zu bestätigen. Precheck nur registrierte argv-Aktion mit Frist, kein aus Orca übernommener Shellstring. Nicht null Exit, Timeout, fehlende Anmeldung, Quota und Host-Ausfall sind getrennte Gründe. Offline erzeugt kein neues Aktivieren/Starten. Fällige Läufe im zulässigen Grace-Fenster höchstens einmal nachholen, außerhalb `skipped_missed`. Überlappung standardmäßig skip statt endloser Queue.

### 3.4 Historie und Recovery
Journal/Snapshot für Definition, Generation, Claims, Run-IDs und Resultate; große Ausgaben Blobs. Neue Definition oder andere Befugnisse invalidiert alte Freigabe. Stop/Disable verhindert neue Dispatches, beendet laufende Jobs nur mit separater Aktion. Retention löscht nicht belegrelevante Artefakte aktiver Runs. K7-Replay unabhängig von langsamen Prechecks/Host-Probes. PWA Automationen-Tabelle mit nächster Ausführung, Host, Status, Fehler und gezieltem Retry.

### Orca-Referenzen und Übernahmegrenzen

Alle Links auf Commit `bdeb388d75120b6e36dd619291286de0cc9aae02`. Einstufung ist eine geprüfte Port-Hypothese, keine behauptete fertige AV-Kompatibilität. Vor Übernahme Imports/Lizenz/Tests/Strip-Type-Tauglichkeit erneut prüfen; keine großen Orca-Subsysteme blind kopieren.

| Quelle | Verwendung in AV |
|---|---|
| [src/shared/automation-schedule-parsing.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/shared/automation-schedule-parsing.ts) | Port-Kandidat für begrenztes Parsing, Abhängigkeiten (cron-field/occurrence/clipboard) mitprüfen; kein pauschaler RRULE-Claim. |
| [src/shared/automation-schedule-dst.test.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/shared/automation-schedule-dst.test.ts) | Testfall-Referenz; eigene dokumentierte DST-Semantik bleibt verbindlich. |
| [src/shared/automation-schedule-occurrences.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/shared/automation-schedule-occurrences.ts) | Zeitzonen-/Next-run-Referenz samt Imports und Testuhr prüfen. |
| [src/main/automations/service.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/automations/service.ts) | Owner-/Lifecycle-/Missed-Referenz; nicht Orca Store/Runtime übernehmen. |

## 4. Aufgaben (Checkliste T41.m)

- [ ] **T41.1** Bestands-/Owner-Abgleich, ADR/Contracts für Zeitplan, Claim, Runstatus und genehmigten Rahmen; keine Doppelautorität. **K5/K7**.
- [ ] **T41.2** Begrenzten Schedule-Parser/Occurrence-Berechnung auswählen; Orca-Port gegen Library/kleinen Eigenbau abwägen, DST-/Oversize-/unmögliche Termine prüfen. **K5/K7**.
- [ ] **T41.3** Host-Scheduler, atomare Claim-/Dedupe-/Overlap-/Missed-Regeln und Recovery mit Fake Clock und Crash-Proben implementieren. **K7/K8**.
- [ ] **T41.4** Registrierte Prechecks und Session-/Run-Dispatch mit Auth-/Quota-/Lease-Fehlern, deaktivierten Plänen und menschlicher Freigabe bauen. **K1/K5/K7**.
- [ ] **T41.5** PWA/CLI Liste/Editor/Vorschau/Run-now/Disable/Verlauf; Orchestrierungsruns verlinken. **K1/K2/K10**.
- [ ] **T41.6** `e2e/specs/automations.spec.ts`, echter kurzer isolierter Zeitplan-Lauf plus Restart und Negativprobe; Gate/PWA-Build/K8. **K1/K5/K7/K8/K10**.

## 5. Acceptance Criteria (AC-P41-k)

- **AC-P41-1:** Ein aktivierter Schedule startet den gewählten Harness/Run auf dem gewählten Host/Arbeitsort und zeigt das Ergebnis.
- **AC-P41-2:** DST doppelt/fehlend, Missed-Grace und Zeitzonenwechsel stimmen mit dokumentierter Vorschau überein.
- **AC-P41-3:** Crash um Claim/Dispatch erzeugt keinen zweiten blind gestarteten Lauf; Unsicherheit ist sichtbar.
- **AC-P41-4:** Nicht erfüllter Precheck, Quota, Direct-Lease oder Auth führt zum zutreffenden Skip-/Fehlergrund.
- **AC-P41-5:** Disable stoppt zukünftige Termine, verändert laufende Arbeit nicht unbemerkt; run-now hat nachvollziehbare ID.
- **AC-P41-6:** Nach Reload/Restart sind Definition, letzte/nächste Ausführung und Artefakte erhalten; offline nur datierte Projektion.

## 6. Premortem (Failure-Modi + Mitigation)

1. Cron feuert nach Neustart doppelt → persistenter Occurrence-Claim plus generationengebundene Startoperation.
2. DST führt zu Überraschung → festgeschriebene Einmal-/Skip-Regel und Vorschau mit Uhrtests.
3. Scheduler erfindet Erfolg nach Spawn → Completion aus Session-/Run-Ergebnis, dispatched getrennt.
4. Precheck wird freie Shell → registrierte argv-Aktion und unveränderte Actor-/Approval-Prüfung.

## 7. Definition of Done

Alle T41.* und AC-P41-* mit aktueller Evidenz, Vorgänger-Exit ausdrücklich grün. `npm run gate` und PWA-Build grün; Pipeline-Job `e2e` grün bzw. Infrastrukturfall nach `docs/ci-runbook.md` nachgezogen, niemals als Pass gezählt. Jede neue UI-Funktion/jeder Ablauf hat einen Spec in `e2e/specs/`; benötigte echte Browser-/Provider-/Geräte-Nachweise separat, Skip ≠ Pass. Neue APIs/Tools/Ansichten sind registriert, in Hub/PWA/hubctl erreichbar und dokumentiert. ADR vor Contract-Änderung, K5/K7/K8 entsprechend Scope nachgewiesen; keine offene TODO ohne Epic-Bezug. Übernommene Orca-Teile mit Commit/Pfad/Hash/Lizenz/Änderungsnotiz und eigenen Tests gemäß Planungsgrundlage.

## 8. Übergabeprüfung vom 10.11.2026

Contracts, Engine, Scheduler und Routen liegen auf `main` (`8f25ef7`).
PWA-/CLI-Oberfläche und E2E aus dem bisherigen Arbeits-Worktree wurden zur
Fortsetzung übernommen. Der Code-Stand ist damit weiter als der historische
Planungsstatus, erfüllt aber noch nicht den vollständigen Epic-Exit.

[Prüfbericht mit AC-Matrix und Gate-Evidenz](../docs/2026-11-10_p41-uebergabepruefung.md).
Offen bleiben insbesondere Run-Ziele, automatische Ergebnisrückführung,
erreichbare Bearbeitung bestehender Pläne, Offline-Verhalten und die Prüfung
von Disable/Generation nach einem laufenden Precheck. BUG-0112/0113 betreffen
Neuanlage-Freigabe und Prompt-Integrität; Korrekturen und Regressionen im
Fortsetzungsbranch. Die obigen Aufgaben bleiben bis zu vollständigen Nachweisen
offen. **P42 ist durch diesen Zwischenstand nicht freigegeben.**
