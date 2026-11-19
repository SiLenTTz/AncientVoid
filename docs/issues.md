# Issue-Lebenszyklus: Anlegen, Triage, Abarbeiten, Schließen

**Art:** referenz

Standard für GitHub-Issues in `securesight-ai/AncientVoid` (EPIC-P71).
Git/Markdown bleibt SSOT (`bugs/`, `epics/`); der Tracker (GitHub) ist die
Zuweisungs- und Sichtfläche. Die beiden dürfen nicht auseinanderdriften —
dieser Standard ist der Weg dorthin. CI-seitige Details: [`ci-runbook.md`](ci-runbook.md) §7.

## Anlage-Klassen

| Klasse | Anlage-Weg |
|---|---|
| Produkt-Defekt | Skill `bug-report`: `bugs/bug-NNNN-slug.md` (SSOT) + `gh issue create --label bug` + `forge:`-Rückverweis in Datei und Indexzeile |
| CI-Fehler | `nightly-bugs.yml` → `reportFailures`: pro fehlgeschlagenem `nightly`/`pipeline-sync`-Job eine Issue (Titelpräfix `CI-Bug:`, Marker-Dedup, Update bei Wiederholung) — automatisch |
| Feature/Epic | `epic-creation` + Tracker-Issue mit `enhancement`-Label und `EPIC-Pn`-Bezug im Titel; die Epic-Statuszeile führt die Issue-Nummer (Muster: EPIC-P61 ↔ #6) |
| Fremd-Report | `.github/ISSUE_TEMPLATE/` (bug_report.md, feature_request.md) → Triage |

## Pflicht-Zuordnung und Triage

Jede offene Issue gehört zu genau einer Klasse und trägt — außer CI-Bugs —
einen `BUG-NNNN`- oder `EPIC-Pn`-Bezug (Titel oder erste Body-Zeile). Eine
Issue ohne Zuordnung wird zugeordnet oder mit Begründung geschlossen — nie
liegen gelassen.

Triage ist Agenten-/Nutzerarbeit per `gh issue list --state open` (kein
Workflow, kein Auto-Labeling) zu zwei verpflichtenden Zeitpunkten:

1. nach jedem `nightly-bugs`-Bericht-Lauf,
2. vor jedem Epic-Abschluss (dann werden alle Issues des Epics gesichtet).

## Abarbeiten und Schließen

- **`Fixes #<nr>` im PR-Body ist Pflicht für jeden PR, der einen Defekt mit
  Tracker-Issue behebt — auch Epic-Task-PRs** (Wurzel von #84: der Fix lief
  über T63.2, nicht über einen `bugfix`-PR, darum blieb die Issue offen).
  GitHub schließt die Issue erst mit Merge des PR.
- **Auto-Close für CI-Bug-Issues:** Ein abgeschlossener `nightly`-Lauf
  schließt offene CI-Bugs der Jobs, die in diesem Lauf grün waren, mit
  Evidenz-Kommentar (Run-ID, SHA, Job-Link) — `closeResolved` in
  `scripts/ci-pipeline.mjs`, Close-Job in `nightly-bugs.yml`. Ein erneuter
  Fehler erzeugt wie bisher eine neue Issue.
- **Re-Open:** Falsch geschlossen (z. B. Flake)? `gh issue reopen <nr>` und
  kurz im Issue begründen; der nächste rote Lauf aktualisiert sie.
- Bug-Dateien (`bugs/`) führen den Fachstand (status, Fix, Tests); die
  Indexzeile in `bugs/README.md` wird mitgeführt.

## Issue-Session-Bridge (EPIC-P73, ADR-0094)

Eine Issue mit dem Label `session` bekommt automatisch eine eigene Hub-Session,
die sie abarbeitet (Outbound-Poll des Hubs, kein Webhook). Das Label ist das
Freigabe-Gate: Labeln braucht Schreibrechte am Repo — erst dann darf der
Issue-Body (als klar abgegrenzter Datenblock, PRD §8.5) zum Session-Prompt
werden. Konfiguration über die `issues`-Sektion der Hub-Config (ADR-0094 §1).

- Die Bridge kommentiert Start und Ergebnis (`succeeded`/`failed`/`timeout`/
  `cancelled`) auf der Issue; Schließen bleibt dem `Fixes #<nr>`-PR überlassen.
- Sync-Marker: Legt die Session zu einem Defekt eine `bugs/bug-NNNN-slug.md`
  an (Skill `bug-report`), tragen Frontmatter und Indexzeile zusätzlich
  `labels:` mit dem Trigger-Label — so hält der SSOT fest, dass die Datei aus
  einer Issue-Session stammt und welcher Tag sie ausgelöst hat.
- CI-Bug-Issues (`nightly-bugs.yml`) bekommen das Label **nicht** automatisch:
  ob Nightly-Fails eigene Sessions starten, ist eine separate Nutzerentscheidung
  (Kosten-/Risikoabwägung), nicht Standard.
- Sichtbar sind Bridge-Zustand und GitHub-Actions-Läufe in der PWA unter
  Automatismen → „Externe Automatismen" (`GET /api/automations/external`).

## Bestand (Sichtung 18.11.2026, EPIC-P71 T71.6)

| Issue | Klasse/Bezug | Entscheidung |
|---|---|---|
| #5 | BUG-0167 (offen, Pin fastify 5.12.5) | bleibt offen — echter Bug, macOS-gebunden |
| #6 | EPIC-P61 (offen) | bleibt offen — trackt Epic-Umsetzung |
| #28 | BUG-0176 (offen, E2E-Flake) | bleibt offen — echter Bug |
| #83 | BUG-0217 (nachgezogen), Label `bug` | offen — Zeitrenne Hosted-Runner, BUG-0170-Umfeld |
| #84 | BUG-0187 (fixed, EPIC-P63 T63.2/AC-P63-2, PR #94) | geschlossen mit Evidenz-Kommentar |
| #85 | BUG-0218 (nachgezogen), Label `bug` | offen — zeitkritische Flakes Tier A, BUG-0170-Umfeld |
| #100–#104 | CI-Bugs (Nightly 44293072822) | bleiben offen bis ihr Job grün läuft → Auto-Close |

Sichtung wiederholen: siehe Triage-Zeitpunkte oben.
