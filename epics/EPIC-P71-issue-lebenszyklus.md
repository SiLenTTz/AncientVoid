# EPIC-P71 — Issue-Lebenszyklus: Anlegen, Triage, Abarbeiten, Schließen

**Status:** offen (Planungsentwurf 18.11.2026 — startet nur auf Nutzervotum) · **Phase:** P71 · **Dauer:** 2–3 Agenten-Tage · **Abhängigkeit:** keine blockierende — Quer-Epic wie P58–P70; P70 (höchste laufende Phase) umgesetzt (PR #172, `verify` grün; main-seitige E2E-Röte benannt, volle Messlatte im Nightly). P30/P31 bleiben On hold und unberührt. P69 ist durch die Umbenennung zu EPIC-000 belegt.

## 1. Ziel

Der Lebenszyklus einer GitHub-Issue in `securesight-ai/AncientVoid` ist Ende-zu-Ende
definiert und teilweise automatisiert: **Anlegen** (Template, Skill oder Workflow —
je Klasse) → **Triage** (Klasse + Zuordnung zu `BUG-NNNN`/`EPIC-Pn`) → **Abarbeiten**
(Branch → PR → Merge mit `Fixes #`-Verknüpfung) → **Schließen** (automatisch mit
Evidenz-Kommentar für CI-Bugs, sobald ihr Job grün läuft). Tracker (GitHub) und
SSOT (`bugs/`, `epics/`) driften nicht mehr auseinander — der heutige Bestand
(11 offene Issues, davon 1 nachweislich stale, 2 unklassifiziert, 13 tote
Tracker-Links in Markdown) wird auf den Standard migriert.

Ist-Analyse vom 18.11.2026 (Belege): Anlage ist weitgehend standardisiert
(`.github/ISSUE_TEMPLATE/`, Skill `bug-report` §6, `nightly-bugs.yml` →
`scripts/ci-pipeline.mjs report`); Abarbeiten läuft für Bugfix-PRs über
`Fixes #<nr>` (PR-Template erzwingt `Closes #`; belegt: #116, #126, #146
COMPLETED). Lücken: kein Schließen nach Epic-Task-Fixes (Beweis #84 —
`bugs/bug-0187` `fixed`, EPIC-P63 T63.2/AC-P63-2 grün, Issue trotzdem offen),
kein Schließweg für CI-Bug-Issues (Runbook §7: „Grüne Läufe schließen Bugs
nicht automatisch"; `reportFailures` in `scripts/ci-pipeline.mjs:61–102` erzeugt
und aktualisiert nur — historisches Schließen #54–#57 war reine Handarbeit),
keine Triage-Regel für Issues ohne Label/bugs/-Datei (#83, #85), 13 Markdown-
Dateien verlinken auf den toten Namespace `github.com/SiLenTTz/AncientVoid`
(HTTP 404, kein Redirect), und es existiert kein Epic↔Issue-Inventar
(`npm run epics:status` liest nur `epics/`).

## 2. Scope (In / Out)

**In:**

- `docs/issues.md` (flach): Lebenszyklus-Standard — Anlage-Klassen, Pflicht-
  Zuordnung, Triage-Schritt, Schließregeln.
- Automatischer Evidenz-Close für CI-Bug-Issues: Erweiterung
  `scripts/ci-pipeline.mjs` + `.github/workflows/nightly-bugs.yml` + Runbook §7.
- Namespace-Migration `SiLenTTz/AncientVoid` → `securesight-ai/AncientVoid`
  in `bugs/` (11 Dateien) und `epics/` (2 Dateien).
- Fix-Verknüpfungspflicht (`Fixes #<nr>` auch für Epic-Task-PRs) in
  `git-workflow`/`epic-creation`/CONTRIBUTING verankert.
- Einordnung und Migration der 11 offenen Issues (§3.5).

**Out:**

- Kein `epic.yaml`, kein PM-Board-Tool, keine GitHub-Projects-Synchronisation
  (Git/Markdown bleibt SSOT).
- Keine automatisierte Triage — Triage bleibt ein definierter Agenten-/Nutzer-
  Schritt (YAGNI: Auto-Labeling für ein Solo-Repo).
- Keine Änderung an `@ancientvoid/contracts` (kein ADR nötig), keine neue
  Bug-Nummernvergabe, keine neuen Labels (CI-Bugs bleiben an Titelpräfix
  `CI-Bug:` + HTML-Marker erkennbar).
- Keine Änderung an `ci.yml`/`nightly.yml`/`pipeline-sync.yml` selbst — nur
  an `nightly-bugs.yml` und seinem Skript.
- P30/P31 unberührt; Epic startet nicht automatisch.

## 3. Design-Details

### 3.1 Anlage-Klassen (bestehende Wege, normiert)

| Klasse | Anlage-Weg | Beleg |
|---|---|---|
| Produkt-Defekt | Skill `bug-report`: `bugs/bug-NNNN-slug.md` (SSOT) + `gh issue create --label bug` + `forge:`-Rückverweis | 20 geschlossene Issues, überwiegend `BUG-NNNN`-Präfix |
| CI-Fehler | `nightly-bugs.yml` → `reportFailures`: pro fehlgeschlagenem `nightly`/`pipeline-sync`-Job eine Issue, Marker-Dedup, Update bei Wiederholung | Runbook §7, `scripts/ci-pipeline.mjs:61–102` |
| Feature/Epic | `epic-creation` + Tracker-Issue mit `enhancement`-Label und `EPIC-Pn`-Bezug im Titel; Epic führt die Issue-Nummer in der Statuszeile (Muster: EPIC-P61 ↔ #6) | `#6`, `EPIC-P61-…md` Zeile 3 |

Manuelle Fremd-Reports laufen über `.github/ISSUE_TEMPLATE/` (bug_report.md,
feature_request.md; `blank_issues_enabled: false`) in die Triage.

### 3.2 Pflicht-Zuordnung und Triage-Schritt

Jede offene Issue gehört zu genau einer Klasse und trägt — außer CI-Bugs —
einen `BUG-NNNN`- oder `EPIC-Pn`-Bezug (Titel oder erste Body-Zeile; heute
schon Praxis, z. B. #5/#28/#84, #6). Triage ist ein definierter Schritt zu
zwei Zeitpunkten: (a) nach jedem `nightly-bugs`-Bericht-Lauf, (b) vor jedem
Epic-Abschluss (dann werden alle Issues des Epics gesichtet). Eine Issue ohne
Zuordnung wird zugeordnet oder mit Begründung geschlossen — nie liegen gelassen.
Triage ist Agenten-/Nutzerarbeit per `gh issue list --state open` — kein Workflow.

### 3.3 Automatischer Evidenz-Close für CI-Bugs

`reportFailures` erweitert bzw. ergänzt um `closeResolved(api, run)`:
Läuft ein `nightly`-Lauf (teilweise) grün, wird für jeden offenen CI-Bug
desselben Jobs (`nightly:<job>`-Marker), dessen Job im aktuellen Lauf grün
war, ein Evidenz-Kommentar gesetzt (Run-ID, SHA, Job-Link — das Muster des
manuellen Schließens von #54–#57, 2026-11-16) und die Issue geschlossen.
Rot gebliebene Jobs werden wie heute aktualisiert, nicht geschlossen; nach
Schließen erzeugt ein neuer Fehler wie bisher eine neue Issue (bestehendes
`reportFailures`-Verhalten). Der Close läuft in derselben
`concurrency: nightly-bugs`-Gruppe und nur mit Code von `main` — keine neue
Berechtigungsklasse (`issues: write` ist vorhanden). Dies löst die bewusste
Runbook-§7-Aussage „Grüne Läufe schließen Bugs nicht automatisch" ab;
§7 wird entsprechend fortgeschrieben (Entscheidung mit Begründung im Diff).

### 3.4 Fix-Verknüpfungspflicht und Erreichbarkeit

Jeder PR, der einen Defekt mit Tracker-Issue behebt, trägt `Fixes #<nr>` im
Body — auch Epic-Task-PRs (Wurzel von #84: der Fix lief über T63.2, nicht über
einen `bugfix`-PR). Verankert in: `.claude/skills/git-workflow/SKILL.md` (PR-Body-
Regel), `.claude/skills/epic-creation/SKILL.md` (DoD-Zeile „zugehörige Issues
gesichtet/geschlossen"), `CONTRIBUTING.md` (Verweis auf `docs/issues.md`), und
`AGENTS.md` (eine Zeile Issue-Lebenszyklus). `docs/issues.md` wird damit
erreichbar (verlinkt aus drei Einstiegsdokumenten) und unterliegt
`npm run check:context` (Frischhalte-/Zeilenbudget-Regeln).

### 3.5 Einordnung der 11 offenen Issues (Ist 18.11.2026, `gh issue list`)

| Issue | Ist | Einordnung |
|---|---|---|
| #5 | `bug`, BUG-0167: fastify ≥ 5.12.6 flaky; `bugs/bug-0167` `status: open`, Pin auf 5.12.5 | bleibt offen — echter Bug, Zuordnung steht |
| #6 | `enhancement`, EPIC-P61: Epic offen (Planungsentwurf), Statuszeile verlinkt #6 | bleibt offen — trackt Epic-Umsetzung; Musterfall der Epic↔Issue-Konvention |
| #28 | `bug`, BUG-0176: Starten-Klick überdeckt (E2E-Flake); `bugs/bug-0176` `status: open` | bleibt offen — echter Bug |
| #83 | ohne Label: 1 von 2139 rot auf Hosted-Runnern, Neustart grün; keine bugs/-Datei | T71.6: bugs/-Datei über `bug-report` nachziehen, Label `bug`, BUG-0170-Kontext im Body |
| #84 | ohne Label: Geister-Tokens; `bugs/bug-0187` `status: fixed`, EPIC-P63 abgeschlossen (T63.2 ✓, AC-P63-2 🟢) — Issue offen | T71.6: mit Evidenz-Kommentar (bug-0187 fixed, AC-P63-2, PR-Verweis) schließen |
| #85 | ohne Label: 3 zeitkritische Flakes unter parallelem Tier A; keine bugs/-Datei; BUG-0170-Verwandtschaft nur im Body | T71.6: bugs/-Datei über `bug-report` nachziehen, Label `bug`, BUG-0170-Kontext |
| #100–#104 | `bug` (CI-Bug): Auto-Bugs des Nightly-Laufs 44293072822 (main f1f6b5c, 18.11.); Nightly aktuell rot | bleiben offen bis der jeweilige Job grün läuft; dann automatischer Evidenz-Close (T71.3) |

### 3.6 Messlatten-Bezug

Prozess-Epic ohne eigene K-Messlatte; indirekt K8 (PRD §9): die nächtliche
Vollmesslatte bleibt nur belastbar, wenn rote Läufe schnell zugeordnet und
abgearbeitet werden — Auto-Close und Pflicht-Zuordnung verkürzen den Weg von
„rot gemeldet" zu „fix zugeordnet". Keine K-Verletzung durch die Änderungen
(kein Produkt-Code, keine Contracts).

## 4. Aufgaben (Checkliste)

- [ ] **T71.1** `docs/issues.md` anlegen: Anlage-Klassen (§3.1), Pflicht-Zuordnung + Triage-Schritt (§3.2), Schließregeln (Auto-Close CI-Bugs, `Fixes #`-Pflicht), Einordnungstabelle der 11 Issues. Verlinkt aus `CONTRIBUTING.md` und `AGENTS.md`; `npm run check:context` grün.
- [ ] **T71.2** Namespace-Migration: `github.com/SiLenTTz/AncientVoid/issues/` → `securesight-ai/AncientVoid/issues/` in `bugs/` (11 Dateien) und `epics/` (2 Dateien); Negativ-Probe `grep -r "SiLenTTz/AncientVoid" bugs/ epics/` = 0 Treffer.
- [ ] **T71.3** `closeResolved(api, run)` in `scripts/ci-pipeline.mjs` + Unit-Tests (`scripts/ci-pipeline.test.mjs`, Fake-API): grüner Job schließt seine CI-Bug-Issue mit Evidenz-Kommentar; rot gebliebener aktualisiert statt schließt; Idempotenz bei Redelivery; Workflow-Startup-Fallback bleibt. Rot-dann-grün belegt.
- [ ] **T71.4** `.github/workflows/nightly-bugs.yml`: Close-Schritt nach jedem abgeschlossenen `nightly`-Lauf (auch grün) innerhalb der bestehenden Concurrency-Gruppe; `docs/ci-runbook.md` §7 fortschreiben („Grüne Läufe schließen CI-Bug-Issues automatisch mit Evidenz-Kommentar").
- [ ] **T71.5** Skills und Einstiege: `git-workflow` (`Fixes #`-Pflicht für jeden Defekt-PR), `epic-creation` (DoD: zugehörige Issues gesichtet; Epic-Statuszeile führt Tracker-Issue), `CONTRIBUTING.md` + `AGENTS.md` (je eine Verweiszeile auf `docs/issues.md`).
- [ ] **T71.6** Bestand migrieren: #84 evidenzkommentiert schließen; #83/#85 bugs/-Dateien nachziehen (`bug-report`), Labels setzen, BUG-0170-Bezug dokumentieren; #5/#6/#28/#100–#104 gemäß §3.5 bestätigen; Ergebnis in `docs/issues.md` festgehalten.
- [ ] **T71.7** Retro (Skill `retro`) gegen die AC; Erkenntnisse an diese Datei anhängen.

## 5. Acceptance Criteria (AC-P71-k)

1. **AC-P71-1 (Triage-Standard):** `docs/issues.md` definiert Anlage, Triage, Abarbeiten, Schließen Ende-zu-Ende; jede offene Issue im Repo ist klassifiziert und — außer CI-Bugs — einem `BUG-NNNN`/`EPIC-Pn` zugeordnet oder als begründete Ausnahme benannt. Beleg: `gh issue list --state open` + Auswertung in `docs/issues.md`.
2. **AC-P71-2 (Auto-Close):** Nach einem grünen `nightly`-Lauf werden offene CI-Bug-Issues desselben Jobs automatisch mit Evidenz-Kommentar (Run-ID, SHA, Job-Link) geschlossen; ein erneuter Fehler erzeugt wie bisher eine neue Issue. Beleg: Unit-Tests + erster Live-Lauf.
3. **AC-P71-3 (Links):** `grep -r "SiLenTTz/AncientVoid" bugs/ epics/` liefert 0 Treffer; alle `forge:`-Verweise zeigen auf `securesight-ai/AncientVoid` und resolve auf die echte Issue.
4. **AC-P71-4 (Bestand):** #84 ist geschlossen mit Verweis auf `bugs/bug-0187` (fixed) und AC-P63-2; #83/#85 haben bugs/-Dateien (Indexzeile in `bugs/README.md`) und Label `bug`.
5. **AC-P71-5 (Erreichbarkeit):** `docs/issues.md` ist aus `CONTRIBUTING.md` und `AGENTS.md` verlinkt; `npm run check:context` grün (Budget/Frischhalte).

## 6. Premortem (Failure-Modi + Mitigation)

1. **Auto-Close schließt unfixed Bugs, weil ein Job zufällig grün flakes.**
   → Der Evidenz-Kommentar nennt Run-ID/SHA/Job-Link (nachvollziehbar wie bei
   #54–#57); tritt der Fehler erneut auf, erzeugt `reportFailures` eine neue
   Issue (Verhalten bleibt); Re-Open-Kommando in `docs/issues.md` dokumentiert.
   Der Trade-off wird bewusst eingegangen: manuelles Liegenlassen (heutiger
   Zustand, siehe #84) ist der größere Fehler.
2. **Namespace-Rewrite erfasst historische Archiv-Verweise, die bewusst auf
   das alte Repo zeigen sollen.**
   → Exakter Match nur auf `github.com/SiLenTTz/AncientVoid/issues/`
   (Tracker-Links); manueller Diff-Review der 13 Dateien; grep-Negativ-Probe
   als AC. Runbook-Historie (gitlab-Archiv-Links) bleibt unangetastet.
3. **Die neue Doku verrottet als tote Datei — niemand triaged.**
   → `docs/issues.md` hängt an `check:context` (Frischhalte/Budget), ist aus
   drei Einstiegsdokumenten verlinkt und Triage ist an zwei verpflichtende
   Zeitpunkte gebunden (nach nightly-bugs-Bericht, vor Epic-Abschluss).
4. **Formalismus-Überbau: Issues werden verwaltet statt gearbeitet (Solo-Projekt).**
   → Keine neuen Labels, keine Automatisierte Triage, kein Sync-Tool; Triage
   bleibt ein kurzer Sichtungs-Schritt; `epics:status` wird nicht erweitert.
5. **Workflow-Änderung bricht die nightly-bugs-Serialisierung oder das Dedup.**
   → Close läuft in derselben `concurrency`-Gruppe nach dem Report;
   Unit-Tests mit Fake-API prüfen Redelivery-Idempotenz; Negativ-Probe:
   ein grüner Lauf ohne offene CI-Bugs schließt nichts und fails nicht.

## 7. Definition of Done

- `npm run gate` lokal grün (`check:*` inkl. `check:context`, Typecheck, Lint,
  Tests); neue Unit-Tests für `closeResolved` rot-dann-grün belegt (T71.3).
- GitHub-Actions auf dem Abschluss-PR grün (`verify`); der nächste `nightly`-
  Lauf nach Merge übt den Auto-Close erstmals live (Ergebnis als Kommentar in
  der zugehörigen CI-Bug-Issue oder — bei grüner Basis — als Negativ-Probe
  „schloss nichts falsch" dokumentiert). Rote CI allein durch die Umgebung
  wird benannt, nie als Pass gezählt.
- Keine UI-Änderung → keine neue `e2e/specs/`-Spec nötig; bestehende Specs
  unberührt.
- AC-P71-1 bis -P71-5 erfüllt und mit Belegen (Run-IDs, Issue-Links, grep)
  in dieser Datei vermerkt; `epics/README.md` aktualisiert.
- Retro (T71.7) gelaufen; Erkenntnisse angehängt.
- Epic startet nicht vor Nutzervotum (Planungsentwurf).
