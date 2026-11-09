# EPIC-P37 — GitLab-Issues, Merge Requests und CI im Session-Kontext

**Status:** in Umsetzung seit 2026-11-09 (P36 umgesetzt, Gating erfüllt) — T37.1–T37.5 als Code gebaut; T37.6 gebaut (E2E-Spec gegen glab-Stub, Runbook `docs/forge-runbook.md`); offen: die echte isolierte GitLab-Abnahme und die Geräteabnahme, beides bewusst bis Feature-Abschluss verschoben (Entscheidung Jan) · **Phase:** P37
**Dauer:** 2–3 Agenten-Wochen (grobe Schätzung, ohne Vorgänger-Restarbeit)
**Abhängigkeit:** P36 mit nachweislich grünen Exit-Kriterien; wirksame Vorgänger-Abnahmen bleiben bindend.

Quelle: [Orca-Vergleich](../docs/2026-11-08_orca-vs-ancientvoid.md) und [Planungsgrundlage mit Übernahmeregister](../docs/2026-11-08_orca-epic-planung.md).
**Planungsauftrag 08.11.2026:** Nutzer beauftragt diese Epics ausdrücklich vor Abschluss der Vorgänger. Das erlaubt Planung, keine Implementierung und keine Aufhebung des Epic-Gatings. Vor T37.1 aktuellen Code-/Test-/Abnahmestand prüfen; historische Überschriften reichen nicht.

## 1. Ziel

Vom Auftrag bis zum überprüfbaren MR im selben Kontext arbeiten: Issue/Branch/MR/Commit/CI anzeigen und ausgewählte Rückmeldungen an einen Agenten geben. GitLab zuerst. K1/K3/K5/K7/K10.

## 2. Scope (In / Out)

**In:** bestehende MRs verknüpfen, Issues als Session-Quelle, MR-Status/Threads/Jobs/Traces lesen, ausgewählte Befunde über P36 versenden, bestätigter Draft-MR-Pfad.
**Out:** neue CI-Ausführung (P28), automatische Merges, generischer Forge-Baukasten ohne zweiten Bedarf, GitHub-/Linear-/Jira-Parität im ersten Ausbau.

## 3. Design-Details

### 3.1 Bestand und Zuständigkeit
P28 betreibt CI, P26 zeigt Factory-Gates, P36 besitzt Feedback-Pakete. Neues Modul `core/src/modules/forge/`, Contracts `contracts/src/forge/`, Hub `modules/forge/forge.routes.ts`, PWA `features/forge/`. Vor Umsetzung bestehende Code-Aktionen und `glab`-Nutzung inventarisieren. Keine globale Provider-Schnittstelle für nur eine Implementierung erzwingen.

### 3.2 GitLab zuerst
Host+Project-ID+MR-IID als Identität, inklusive self-hosted GitLab. Zugang über vorhandene lokale `glab`-Anmeldung oder Secret-Referenz; keine Token im PWA-Storage/Journal. Befehle als argv, Host-/Projektzuordnung aus geprüften Daten. Threads und Job-Traces paginiert, Cache mit Zeitstempel, Rate-Limits und Offline sichtbar. Pipeline-Status `pending`, `skipped`, `canceled`, `failed`, `success` getrennt; fehlender Runner ist kein Pass. Child-/Bridge-Jobs nicht still unterschlagen.

### 3.3 Rückmeldung und Außenwirkung
Feedback trägt Pipeline-/Job-ID und geprüfte SHA. Abweichende aktuelle MR-SHA wird als veraltet markiert. Fremde Kommentare/Logs sind zitierte Daten, niemals Ausführungsbefugnis. Mensch wählt einen Folgeauftrag. Draft-MR-Erstellung zeigt Zielbranch, Titel in Commit-Notation, Beschreibung und tatsächlichen Push-Stand zur Bestätigung. Nur über `glab mr`/API auf GitLab, niemals lokaler Feature→main-Merge. Keine Nachricht/Review-Submission ohne explizite Aktion; Statusabfrage ist read-only.

### 3.4 Recovery
Verknüpfungen/Operationen aus Journal/Snapshot, externe Wahrheit nach Neustart erneut prüfen. MR-Anlage mit persistenter Operation und Suche nach bereits erzeugtem MR bei verlorener Antwort. Große Logs als gekappte Vorschau+Blob; Cache beweist keinen aktuellen CI-Erfolg.

### Orca-Referenzen und Übernahmegrenzen

Alle Links auf Commit `bdeb388d75120b6e36dd619291286de0cc9aae02`. Einstufung ist eine geprüfte Port-Hypothese, keine behauptete fertige AV-Kompatibilität. Vor Übernahme Imports/Lizenz/Tests/Strip-Type-Tauglichkeit erneut prüfen; keine großen Orca-Subsysteme blind kopieren.

| Quelle | Verwendung in AV |
|---|---|
| [src/main/gitlab/merge-request-review-mutations.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/gitlab/merge-request-review-mutations.ts) | Port-Vorlage für konkrete glab-API-Argumente; Connection-/Host-Abhängigkeiten durch AV-Modul ersetzen. |
| [src/main/source-control/hosted-review-creation-gitlab-self-hosted.test.ts](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/src/main/source-control/hosted-review-creation-gitlab-self-hosted.test.ts) | Testfall-Referenz für self-hosted und Host-Zuordnung. |
| [docs/site/content/docs/review/github.mdx](https://github.com/stablyai/orca/blob/bdeb388d75120b6e36dd619291286de0cc9aae02/docs/site/content/docs/review/github.mdx) | Produktreferenz für GitLab-Jobs/Threads; GitHub-only Aktionen nicht als GitLab-Fähigkeit behaupten. |

## 4. Aufgaben (Checkliste T37.m)

- [x] **T37.1** Bestand, Authpfad, ADR/Contracts für Forge-Identität, SHA-Bezug und Operationsstatus festlegen. **K5/K7**.
- [x] **T37.2** GitLab-Reader für MR/Issues/Threads/Pipelines/Jobs inkl. Child-/Bridge-Jobs; Auth-/Rate-Limit-/Netzfehler und Pagination testen. **K3/K5/K10**.
- [x] **T37.3** PWA-Panel und Issue→Session-Start mit Quellreferenz integrieren; aktuelle Branch-/MR-SHA ständig erkennbar. **K1/K2/K7**.
- [x] **T37.4** Gezielte CI-/Review-Rückgabe über P36 mit Log-Blob, veraltetem SHA-Fall und Auswahlvorschau bauen. **K3/K5/K7**.
- [x] **T37.5** Bestätigte Draft-MR-Erstellung, Git-Regelprüfung und Retry-Abgleich; keine Duplikate bei Antwortverlust. **K5/K7**.
- [ ] **T37.6** `e2e/specs/forge-review.spec.ts`, echte isolierte GitLab-Projekt-Abnahme (keine Produktiv-Mutation), Gate und Runbook. **K1/K3/K5/K7/K10**. — Spec (`forge-review.spec.ts`) und Runbook gebaut 2026-11-09; **offen:** echte isolierte GitLab-Abnahme (Runbook §3)

## 5. Acceptance Criteria (AC-P37-k)

- **AC-P37-1:** Eine Session zeigt eindeutig Host/Projekt/MR, Branch und SHA; zwei Hosts mit gleicher IID kollidieren nicht.
- **AC-P37-2:** Pending/Skipped/Runner-Ausfall sind nie grün; Child-Job-Fehler sind auffindbar.
- **AC-P37-3:** Der ausgewählte Fehler erreicht den Agenten samt Job-/SHA-Quelle; veraltete Traces werden markiert.
- **AC-P37-4:** Lesen erzeugt keine externen Kommentare/MRs; Draft-MR nur nach menschlicher Aktion und im gewählten Ziel.
- **AC-P37-5:** Verlorene Antwort bei MR-Erstellung produziert beim Retry keinen zweiten MR.
- **AC-P37-6:** Offline-Cache zeigt Datum; Token erscheinen weder im Client noch in Events/Traces.

## 6. Premortem (Failure-Modi + Mitigation)

1. Alter Job wird als aktueller Fehler behoben → SHA pinnen und Drift markieren.
2. Polling erschöpft API-Kontingent → Paging, Cache und Backoff, gezielte Aktualisierung.
3. Agentenlog wird Instruktion → Daten-/Quellenrahmen und menschliche Auftragsauswahl.
4. MR-Pfad umgeht Git-Hygiene → main-Merge ausschließlich bei GitLab, bestehende Commit-/Gate-Regeln.

## 7. Definition of Done

Alle T37.* und AC-P37-* mit aktueller Evidenz, Vorgänger-Exit ausdrücklich grün. `npm run gate` und PWA-Build grün; Pipeline-Job `e2e` grün bzw. Infrastrukturfall nach `docs/ci-runbook.md` nachgezogen, niemals als Pass gezählt. Jede neue UI-Funktion/jeder Ablauf hat einen Spec in `e2e/specs/`; benötigte echte Browser-/Provider-/Geräte-Nachweise separat, Skip ≠ Pass. Neue APIs/Tools/Ansichten sind registriert, in Hub/PWA/hubctl erreichbar und dokumentiert. ADR vor Contract-Änderung, K5/K7/K8 entsprechend Scope nachgewiesen; keine offene TODO ohne Epic-Bezug. Übernommene Orca-Teile mit Commit/Pfad/Hash/Lizenz/Änderungsnotiz und eigenen Tests gemäß Planungsgrundlage.
