# ADR-0049: Selbstverwalteter CI-Runner im Docker auf dem Arbeitsplatzhost

**Status:** angenommen (2026-11-05) · **Bezug:** EPIC-P28, AGENTS.md (GitLab-CI-Abschnitt), [CI-Gate-Inventar](../ci-gate-inventar.md), [CI-Runbook](../ci-runbook.md)

## Kontext

Die GitLab-CI des Projekts ist seit dem 09.10.2026 (letzte grüne Pipeline
2931151763) nicht mehr belastbar: Das Free-Tier-Kontingent (400
Compute-Minuten/Monat) ist aufgebraucht (499 verbraucht am 05.11.2026),
alle Jobs enden mit `ci_quota_exceeded`, ohne zu starten; ein E2E-Job
wurde sogar während des Laufs abgebrochen. Der E2E-Job allein kostet
~25–30 min pro Pipeline — das Kontingent reicht für keine MR-Kultur mit
Remote-Nachweisen. EPIC-P28 verlangt deshalb zunächst Ursachendiagnose
(erfolgt, siehe Gate-Inventar) und dann eine Entscheidung über die
Ausführungsform, **bevor** ein Runner aktiviert wird.

Zur Wahl standen (Vergleich nach den Kriterien aus EPIC-P28 §3.2):

| Option | Kosten | Wartung | Secrets/Tailnet | Ausfallverhalten |
|---|---|---|---|---|
| **A. Weiter Shared-Runner + Reset 01.12.** | 0 €, aber 400 min/Monat decken keine MR-Nachweise | keine | keine eigenen | rot bei jedem Kontingent-Ende, monatelang unplanbar |
| **B. Selbstverwalteter GitLab-Runner im Docker auf dem Arbeitsplatzhost** | 0 € (eigene Hardware) | Container-Update, Start nach Reboot (systemd-Unit) | Runner-Token nur lokal außerhalb des Repos; Jobs erhalten **keine** produktiven Credentials | Pipelines warten sichtbar (`pending`), solange der Host aus ist — ehrlich, lokal über Container-Repro ersetzbar |
| **C. Privater GitHub-Actions-Mirror** | 0 € (Free-Stunden), zweites Remote | Spiegel-Sync, doppelter Ursprung | Spiegel braucht Repo-Zugang; versehentliche Veröffentlichung ist ein echtes Risiko (Premortem 4) | von GitLab unabhängig, aber zweites System zu pflegen |
| **D. Compute-Minuten kaufen** | laufende Kosten | keine | keine eigenen | planbar, aber Abonnement für ein Solo-Projekt |

## Entscheidung

**Option B:** Ein selbstverwalteter GitLab-Runner (Docker-Executor) läuft
als eigener Container (`ancientvoid-ci-runner`) auf dem Arbeitsplatzhost
(diese Entscheidung traf der Nutzer am 05.11.2026 ausdrücklich als
Betriebsentscheidung im Rahmen von T28.2; Host-, Kosten- und Secret-Grenzen
sind damit geklärt). Kein Public-Mirror (Option C verworfen), kein
Minutenkauf (D verworfen), kein Abwarten des Resets als Strategie (A nur
noch als notgedrungener Fallback, wenn der eigene Host ausfällt).

Betriebsgrenzen (alle umgesetzt, siehe Runbook):

- Runner-Token liegt nur in `~/.config/ancientvoid-ci-runner/config.toml`
  (chmod 600, **außerhalb** des Repos, nie committen).
- Jobs laufen als kurzlebige Build-Container aus `node:26`
  (pull policy `always`), Concurrency 1, cgroup-Limits (CPUs/RAM) pro Job —
  der Runner beeinflusst laufende Agenten-Sessions des Alltagsshosts nicht
  unkontrolliert (Premortem 1 aus EPIC-P28).
- Kein Docker-Socket, kein `privileged`, keine Volumes mit produktiven
  Daten in Build-Container; `data/` liegt außerhalb der Repos und ist
  git-ignored — ungeprüfter MR-Code erhält weder Produktionsdaten noch
  Deployment-Secrets.
- Pipelines laufen ausschließlich auf dem Projekt-Runner (Tag `av-docker`),
  damit Shared-Runner nicht still Kontingent verbrauchen.

## Konsequenzen und Nachweis

- CI-Nachweise sind ab sofort unabhängig vom gitlab.com-Kontingent; die
  drei SHA-gebundenen grünen Gesamtläufe (EPIC-P28 AC-P28-2) entstehen auf
  diesem Runner, inklusive eines kalten Laufs ohne Cache (Neuaufbau-Nachweis
  T28.2 über `scripts/ci-repro.sh` im selben Image).
- Fällt der Host oder Runner aus, bleiben Pipelines sichtbar `pending`;
  der Ausfallpfad ist über [ci-runbook.md](../ci-runbook.md) lokal per
  Container-Repro reproduzierbar (AC-P28-4). Die lokalen Gates bleiben
  verbindlich (AGENTS.md); an der Merge-Regel ändert dieser ADR nichts.
- Neue Abhängigkeiten: Docker auf dem Host (vorhanden), gitlab-runner-Image
  (gepinnt im Runbook). Versionsstempel (Node/npm/Playwright) stehen im
  Gate-Inventar und in jedem Job-Report.
