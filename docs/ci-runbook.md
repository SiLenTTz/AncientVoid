# CI-Runbook: GitHub Actions, rote Läufe, lokale-vs-CI-Regel

**Art:** how-to

Stand: 16.11.2026 · Workflow: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) ·
Inventar: [CI-Gate-Inventar](ci-gate-inventar.md) · Historie: [EPIC-P28](../epics/EPIC-P28-reproduzierbare-ci.md),
[ADR-0049](adr/0049-selbstverwalteter-ci-runner.md)

## 0. Geltung seit 16.11.2026

Das Projekt liegt öffentlich auf GitHub (`SiLenTTz/AncientVoid`). Die gehostete
CI ist **GitHub Actions** auf GitHub-gehosteten `ubuntu`-Runnern.

| Nachweis | Pflicht für PRs nach `main` |
|---|---|
| Lokale Gates (`AGENTS.md`, Abschnitt Kommandos) | ja, vor jedem PR |
| GitHub Actions PR-Gate (`ci.yml`, Job `verify`: schnelle Kern-Tests, Lint, Typecheck, Build) | ja, Required Check per Branch-Protection |
| GitHub Actions volle Messlatte (`nightly.yml`: volle Vitest-Suite inkl. Slow-Tests, `k8`, `e2e` als Shard-Matrix) | nein — sie läuft auf jedem Push nach `main` und zweimal täglich im Zeitlauf (laufzeit-Beschluss 16.11.2026) |

- Beide Nachweise gelten **zusätzlich**, keiner ersetzt den anderen.
- Ein roter Lauf blockiert den Merge. Liegt die Ursache nachweislich nur in
  der Umgebung (Runner-Flake, Dienst-Ausfall, Netz beim `npm ci`), wird das im
  PR benannt und der Lauf **einmal** neu gestartet (§3) — nie als Pass gemeldet.
- `cancelled`/fehlende Jobs sind kein Pass. Abgebrochene oder veraltete
  Läufe (älterer SHA) zählen nicht. Auf PRs läuft bewusst nur der schnelle
  Gate (`verify`); die vollen Läufe (Push auf `main`, Zeitplan) müssen voll
  durchlaufen — dort ist jeder Skip und jeder fehlende Job kein Pass.
- **Keine self-hosted Runner** für dieses öffentliche Repo (§4).
- Produktfunktionen für GitLab (Forge-Modul, EPIC-P37) sind davon unberührt;
  diese Regel betrifft nur die CI dieses Repos.

**Historie:** Bis 16.11.2026 lag das Projekt privat auf `gitlab.com`; die
Pipeline (`.gitlab-ci.yml`) lief auf dem selbstverwalteten Projekt-Runner
`av-docker` ([ADR-0049](adr/0049-selbstverwalteter-ci-runner.md),
EPIC-P28). Ab 15.11.2026 galt sie dort nicht mehr als Merge-Gate. Alte
Links auf `gitlab.com/SiLenT_Tz/…` zeigen auf das private Archiv.

## 1. Jobs

| Job | Inhalt | Lokales Gegenstück |
|---|---|---|
| `verify` (`ci.yml`, PR-Gate) | `npm ci`, Typecheck, Lint, Checks (`check:*`), schnelle Kern-Tests (ohne Slow-Liste), PWA-Build | `npm run test:fast && npm run lint && npm run typecheck` |
| `vitest-full` (`nightly.yml`) | die komplette Vitest-Suite inkl. Slow-Tests (Liste `scripts/slow-tests.json`, Generator `scripts/gen-slow-tests.mjs`, Drift-Vorschlag im Log) | `npm test` |
| `k8` (`nightly.yml`) | Lasttest 20 Sessions × 30 ev/s | `npm run loadtest` |
| `e2e-shards` + `e2e` (`nightly.yml`) | Playwright Chromium gegen einen echten Hub, danach Skip-Bericht (4 Shards parallel, Browser-Cache); der Aggregations-Job `e2e` fasst die Shard-Berichte nach denselben Regeln zusammen (fehlender Bericht, null Tests, Failures — `scripts/ci-e2e-aggregate.mjs`) | `npm run test:e2e` |

Der PR-Gate läuft auf jedem PR (auch reine Doku- und Dependabot-PRs);
die vollen Läufe (`nightly.yml`) laufen auf Push nach `main`, im Zeitlauf
(zweimal täglich) und per `workflow_dispatch`. Ein neuer Push auf denselben
Zweig bricht den laufenden Lauf ab (`concurrency`). Die genaue Schrittfolge
steht ausschließlich in `ci.yml` und `nightly.yml`. **K8 bleibt
20 Sessions × 30 Events/s**, lokal wie in CI; keine Job-Konfiguration darf
diese Messlatte entschärfen. Fehlt in CI der Browser, muss `e2e` rot enden,
nicht still skippen.

## 2. Einen Lauf lesen

```bash
gh pr checks <nr>                         # Status aller Checks eines PRs
gh pr checks <nr> --watch                 # bis zum Ende verfolgen
gh run list --branch <branch> --limit 5   # Läufe eines Branches
gh run view <run-id>                      # Jobs und Schritte
gh run view <run-id> --log-failed         # nur die Logs der fehlgeschlagenen Schritte
gh run download <run-id> -n e2e-report-shard-1 -D e2e-report-shard-1   # Artefakt laden
```

Artefakte (14 Tage): `vitest-junit` aus `verify`/`vitest-full` (JUnit-XML) und
`e2e-report-shard-<n>` aus den Shard-Jobs (`playwright-report/` mit Traces/Screenshots,
`test-results/` mit JUnit-XML, `ci-artifacts/e2e-report.md` mit benannten
Skips). `gh run view <run-id>` listet sie. Artefakte sind im öffentlichen Repo für
alle sichtbar — daher keine Secrets, Hostnamen oder Home-Pfade in Test-Output.

Lokaler Nachbau eines Linux-Laufs im Container (Default-Image `node:26`, per
`CI_REPRO_IMAGE` änderbar — CI nutzt Node 24; kalt ohne Cache):

```sh
scripts/ci-repro.sh            # verify inkl. K8
scripts/ci-repro.sh --e2e      # zusätzlich Playwright/Chromium
scripts/ci-repro.sh --warm     # mit npm-Cache-Volume (Schnelltest, kein Kaltbeweis)
```

## 3. Fehlerklasse und Re-run

Vor jedem Re-run die Klasse aus `--log-failed` bestimmen:

| Befund | Klasse | Maßnahme |
|---|---|---|
| Test-, Lint-, Typ- oder Check-Fehler | Produkt/Test | **kein Re-run** — Ursache lesen, Fix pushen; lokal mit demselben Kommando reproduzieren |
| Nur in CI rot, lokal grün | Umgebung **oder** latenter Bug | erst `scripts/ci-repro.sh` (Linux, kalt); reproduziert → Bug (`bug-report`) |
| Runner-Abbruch, Timeout ohne Testbezug, Netzfehler bei `npm ci`/Browser-Download | Infrastruktur | **einmal** neu starten, beide Läufe im PR benennen |

```bash
gh run rerun <run-id> --failed     # nur fehlgeschlagene Jobs wiederholen
gh run rerun <run-id>              # kompletter Lauf
```

Produktfehler werden nie durch Wiederholen grün. Zeitkritische Tests, die
nur auf langsameren Runnern rot werden, sind Bugs (Vorbild BUG-0092), keine
Flakes zum Wegklicken.

## 4. Sicherheit für das öffentliche Repo

**Keine self-hosted Runner.** Ein öffentliches Repo führt Workflows für
Pull Requests aus Forks aus; ein eigener Runner würde fremdem Code
Zugriff auf einen persönlichen Rechner und dessen Netz geben (persistente
Prozesse, Cache-Vergiftung, Netzzugriff). GitHub-gehostete Runner sind pro
Job frisch und isoliert.

Einstellungen (*Settings → Actions → General*) und Workflow-Regeln:

- **Fork-PR-Workflows brauchen Freigabe** („Require approval for all
  external contributors“). Vor der Freigabe den Diff lesen — besonders
  Änderungen an `.github/`, `package.json`-Skripten, Lockfile und `scripts/`.
- **`GITHUB_TOKEN` standardmäßig read-only** („Read repository contents
  permission“); Workflows setzen `permissions:` explizit und minimal.
- Trigger ist **`pull_request`, nie `pull_request_target`** — sonst liefe
  Fork-Code mit Schreib-Token und Secrets des Basis-Repos.
- **Actions per Commit-SHA gepinnt** (`uses: owner/action@<sha> # vX.Y`),
  nicht per Tag.
- **Dependabot** hält die gepinnten Actions aktuell (`.github/dependabot.yml`,
  Ökosystem `github-actions`); Updates laufen als normale PRs durch dieselbe CI.
- **Keine Secrets** in Workflows. Braucht ein Job je eines, nur über
  Environments mit Freigabe und nie in Jobs, die Fork-Code ausführen.
- Branch-Protection auf `main` (Ruleset `main-gate`, aktiv seit 16.11.2026):
  Required Check ist `verify` (der schnelle PR-Gate aus `ci.yml`, ohne
  Auto-Update-Regel — der Gate prüft ohnehin den Merge-Ref); kein
  Force-Push (non-fast-forward), kein Löschen von `main`. Direkter Push auf
  `main` ist erlaubt und löst den vollen Lauf aus; normale Arbeit geht per
  PR. Die vollen Läufe (`nightly.yml`) sind kein PR-Gate.

## 5. Lokale-vs-CI-Regel

- Lokal vor jedem Commit-Vorschlag: `npm test`, `npm run lint`,
  `npm run typecheck`; bei PWA/Server-Routen/SessionManager/Adaptern
  zusätzlich `npm run test:e2e`; vor Bugfix-/Epic-PRs `npm run gate`.
- Keine schweren lokalen Läufe (Loadtest, Voll-E2E) parallel zueinander auf
  einem ausgelasteten Arbeitsrechner — der timing-sensible K7-Recovery-Test
  scheitert sonst
  ([BUG-0092](../bugs/bug-0092-k7-recovery-test-flaky-parallel-last.md)).
- Lokal betroffene Packages testen; vollständiges E2E nur bei UI-/Routen-/
  SessionManager-/Adapter-Änderungen (AGENTS.md). CI fährt `k8`/`e2e` auf
  jedem PR mit Code-Änderung voll.

## 6. Negativproben (jährlich oder nach Workflow-Umbau)

1. **Absichtlich fehlerhafter Test:** Wegwerf-Branch mit rotem Test als PR
   → `verify` muss rot sein, Merge-Button gesperrt; PR schließen, Branch löschen.
2. **Fehlender Chromium:** Wegwerf-Branch, der den Browser-Install aus `e2e`
   entfernt → Job muss rot enden (kein stiller Skip).
3. Danach denselben sauberen Commit erneut laufen lassen und grün sehen.

Belege (Run-IDs) im jeweiligen PR bzw. Epic unter Abschlussnachweisen.
