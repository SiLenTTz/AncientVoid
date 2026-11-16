# CI-Runbook: Runner-Betrieb, Ausfallpfad, lokale-vs-CI-Regel

**Art:** how-to

Stand: 15.11.2026 · Epic: [EPIC-P28](../epics/EPIC-P28-reproduzierbare-ci.md) ·
ADR: [ADR-0049](adr/0049-selbstverwalteter-ci-runner.md) ·
Inventar: [CI-Gate-Inventar](ci-gate-inventar.md)

## 0. Geltung seit 15.11.2026

Nutzerentscheid: Das aktuelle Free-Projekt auf `gitlab.com` verwendet die
**lokalen Gates als verbindliche Abschluss- und Merge-Nachweise**. Die
Pipeline wird erst zusätzlich verbindlich, wenn das aktive Git-Remote und
die Projekt-API auf einen tatsächlich lokal betriebenen GitLab-Server zeigen.
Ein eigener Runner an `gitlab.com` ist kein lokaler GitLab-Server. Ein
beliebiger anderer externer GitLab-Host belegt ebenfalls keinen lokalen Betrieb;
im Zweifel gelten die lokalen Gates, bis das aktive Serverziel geklärt ist.

| Aktives Forge-Ziel | Lokale Gates | CI als Merge-/Epic-Gate |
|---|---|---|
| `gitlab.com` (Free), mit Shared- oder eigenem Runner | Pflicht | nicht anwendbar |
| Tatsächlich lokal betriebener GitLab-Server, Projekt/Remote/API darauf eingestellt | Pflicht | zusätzlich Pflicht |

Auf `gitlab.com` sind `failed`, `pending`, `skipped`, fehlende Jobs und Quota
kein eigener Abschlussmangel. Kein automatisches Warten/Pollen/Retry oder
Nachziehen und keine wiederkehrende Warnung allein wegen dieses Status.
Fremde Jobs/Runner dafür nicht abbrechen, pausieren oder umkonfigurieren.
Bei einer Gate-Abnahme genügt „CI nicht anwendbar (gitlab.com)“; explizite
Statusfragen weiter wahrheitsgemäß beantworten. Ein nicht anwendbarer oder
fehlgeschlagener Lauf ist niemals ein Pass. Konkret belegte Produktfehler
bleiben unabhängig vom Ausführungsort Bugs; lokale Tests werden nicht gelockert.
Produktabnahmen wie P37 (echte Job-Traces lesen) entfallen nicht: Die Regel
betrifft den Pipeline-Status als Freigabe-Gate, nicht die Forge-Funktion selbst.

Diese Geltung ersetzt ältere unbedingte Pipeline-Pflichten in Epics und
Runbooks. Historische CI-Nachweise, `.gitlab-ci.yml` und Report-Zähler bleiben
erhalten. Die folgenden Betriebs-/Ausfallregeln sind für freiwillige Cloud-CI
technische Referenz; als Pflicht gelten sie erst im lokalen GitLab-Betrieb.

## 1. Runner-Betrieb (Projekt-Runner `av-docker`)

Die Jobs laufen auf einem **eigenen Projekt-Runner** mit Tag `av-docker`
(Docker-Executor, ausschließlich getaggte Jobs). Pipelines verbrauchen dadurch
keine Shared-Runner-Minuten. Wer das Repo forkt, braucht einen eigenen Runner
mit diesem Tag oder passt die `tags:` in `.gitlab-ci.yml` an.

Einen Projekt-Runner aufsetzen (Kurzform, Details: GitLab-Doku „Install
GitLab Runner in a container“):

1. In GitLab unter *Settings → CI/CD → Runners* einen Projekt-Runner mit Tag
   `av-docker` anlegen, „Run untagged jobs“ aus, „Lock to current projects“ an.
2. `gitlab/gitlab-runner` als Container mit `--restart unless-stopped` starten
   und mit dem angezeigten Token registrieren. Die `config.toml` liegt
   **außerhalb** des Repos (chmod 600, enthält das Runner-Token). Sanitisiert:

```toml
concurrent = 1

[[runners]]
  name = "av-docker"
  url = "https://gitlab.com"
  token = "<nur lokal, nie committen>"
  executor = "docker"
  [runners.docker]
    image = "node:26"
    privileged = false
    pull_policy = ["always"]
    shm_size = 2147483648        # 2 GiB /dev/shm für Chromium
    volumes = ["/cache"]
    # CPU-/RAM-Limits (cpus, memory) passend zum Host setzen
```

Betriebsgrenzen (ADR-0049): Jobs laufen in kurzlebigen Build-Containern
(`pull_policy: always`, Concurrency 1, CPU/RAM-Limits), damit der Host
nebenher nutzbar bleibt. Build-Container erhalten **keinen** Docker-Socket,
kein `privileged`, keine Volumes mit produktiven Daten; das Repo-`data/` ist
git-ignored und landet nie im Job. Es gibt keine CI-Variablen mit Secrets im
Projekt.

- **Bewusst ohne Runner-Cache:** Jeder Job macht ein vollständiges `npm ci`
  aus dem `package-lock.json` und lädt Chromium frisch. Jeder Lauf ist damit
  ein Kaltlauf (EPIC-P28 Premortem 2 — ein Cache kann fehlende Pakete nicht
  kaschieren), die Laufzeit bleibt ehrlich (~5 min verify, ~24 min e2e).
  Soll Cache später aktiviert werden, sind getrennte Schlüssel pro Job
  Pflicht (Cache-Pollution-Lektion: Chromium-Binaries im verify-Workspace
  ließen `eslint .` über Browser-JS stolpern).
- **Keine schweren lokalen Läufe parallel zum Runner,** wenn er sich CPU/IO
  mit einem Arbeitsrechner teilt: Ein paralleler Volllauf (ci-repro,
  loadtest, komplette Testsuite) hat den timing-sensiblen K7-Recovery-Test
  zum Scheitern gebracht
  ([BUG-0092](../bugs/bug-0092-k7-recovery-test-flaky-parallel-last.md)).
  Die verbindliche lokale Abnahme hat Vorrang vor freiwilliger Cloud-CI; aus
  deren Status entsteht keine CI-Wartepflicht (Geltung §0). Fremde laufende
  Jobs nicht ohne Auftrag unterbrechen.
- **Runner aktualisieren:** Container stoppen und entfernen, neues
  `gitlab/gitlab-runner:v<x.y.z>`-Image ziehen, mit derselben `config.toml`
  neu starten; Version im Job-Log prüfen.
- **Runner abschalten:** Container stoppen und den Runner in der GitLab-UI
  pausieren. Danach gilt wieder die Kontingent-Situation aus
  [ci-gate-inventar.md](ci-gate-inventar.md) §3A.

### Härtung für das öffentliche Repo

Ein öffentliches Projekt darf fremdem Code keinen Zugriff auf den eigenen
Runner geben:

- **Runner an das Projekt gesperrt** („Lock to current projects“), nur
  getaggte Jobs; kein Gruppen- oder Instanz-Runner.
- **Nur geschützte Branches** (`main`) laufen auf dem eigenen Runner
  („Protected“-Runner bzw. `rules:` auf geschützte Refs); keine Secrets als
  CI-Variablen, und falls doch nötig nur als *protected + masked*.
- **Keine Pipelines für Fork-MRs** im Elternprojekt: MRs aus Forks laufen
  höchstens im Fork selbst (eigener Runner des Forks); Maintainer starten
  Pipelines für Fork-Code nur nach Review.
- **Pipeline-Sichtbarkeit nur für Mitglieder** (*Settings → General →
  Visibility → CI/CD: Only Project Members*), damit Job-Logs keine
  Host-Details nach außen tragen.

## 2. Ausfallpfad: bekannte Runner-Ausfälle lokal reproduzieren

Nur soweit CI nach §0 verbindlich ist: Ist der Runner oder GitLab nicht
erreichbar (oder ist das Kontingent erschöpft,
solange kein eigener Runner läuft), ersetzt der lokale Container-Repro die
Nachweisführung — dieselben Schritte wie der `verify`-Job, im selben Image:

```sh
scripts/ci-repro.sh            # kalt: komplettes verify inkl. K8 20×30×10 (~10–15 min)
scripts/ci-repro.sh --e2e      # zusätzlich Playwright/Chromium (~25–35 min mehr)
scripts/ci-repro.sh --warm     # mit npm-Cache-Volume (Schnelltest, kein Kaltbeweis)
```

Der Kaltlauf (Default) beweist den Neuaufbau ohne Cache (T28.2). Das Ergebnis
ist ein lokales Äquivalent des Jobs, **kein** Ersatz für die
Abschlussnachweise aus AC-P28-2 — die brauchen echte Pipelines am SHA.

## 3. Fehlerklassifikation und Retry-Regel

Vor jedem Retry die Fehlerklasse anhand Job-Trace/API bestimmen
(`glab api projects/SiLenT_Tz%2FAncientVoid/jobs/<id>` → `failure_reason`):

| `failure_reason` | Klasse | Maßnahme |
|---|---|---|
| `ci_quota_exceeded` | Infrastruktur (Kontingent) | kein Produktfehler; auf eigenem Runner strukturell behoben. Nur relevant, falls jemand Jobs ohne Tag `av-docker` laufen lässt |
| `script_failure` | Produkt-/Testfehler | **kein Retry** — Ursache im Trace/Artefakt lesen, Fix bauen; erster Fehlversuch bleibt sichtbar |
| `runner_system_failure`, `stuck_or_timeout_failure` | Infrastruktur (Runner/Host) | Runner-Logs prüfen (`docker logs`), Host-Ressourcen prüfen, **einmal** wiederholen und beide Versuche im MR benennen |
| Job bleibt `pending` | Runner offline | Abschnitt 1; solange offline: Repro aus Abschnitt 2, Pipeline später am selben SHA nachziehen |

Retries ausschließlich für klassifizierte Infrastrukturfehler; Produktfehler
werden nie durch Wiederholen grün (EPIC-P28 §3.3).

## 4. Lokale-vs-CI-Regel (Nutzerentscheid 15.11.2026)

- **Lokale Gates bleiben verbindlich** (AGENTS.md):
  `npm test`, `npm run lint`, `npm run typecheck` vor jedem Commit-Vorschlag;
  `npm run test:e2e` bei PWA/Server/SessionManager/Adapter-Änderungen;
  `npm run gate` vor Bugfix-/Epic-MRs. Diese Regel wurde durch P28 **nicht**
  geändert.
- **CI-Pflicht nur im lokalen GitLab-Betrieb:** Am Abschluss-SHA müssen dann
  die vorgesehenen `verify`-, `k8`- und `e2e`-Jobs mit ihren Berichten laufen;
  Ausfälle nach §2/§3 behandeln. Auf `gitlab.com` ist dies nicht anwendbar,
  auch mit eigenem Runner. Lokale Nachweise brauchen dort keinen zusätzlichen
  CI-Ausfall-Repro oder nachgezogenen Pipeline-Lauf.
- **K8 bleibt 20 Sessions × 30 Events/s**, lokal wie in CI (`npm run
  loadtest`). Keine Job-Konfiguration darf diese Messlatte entschärfen.

## 5. Negativproben (jährlich oder nach Runner-Wechsel wiederholen)

1. **Absichtlich fehlerhafter Test:** Wegwerf-Branch mit einem rot machenden
   Test pushen → Pipeline muss rot sein; Branch löschen.
2. **Fehlender Chromium:** Wegwerf-Branch, der `npx playwright install …`
   aus dem `e2e`-Job entfernt → Job muss rot enden (Playwright schlägt laut
   an, der Bericht meldet die fehlende JUnit-Datei); Branch löschen.
3. Danach denselben sauberen Commit erneut laufen lassen und grün sehen.

Die Belege (Pipeline-/Job-IDs) stehen im Epic unter Abschlussnachweisen.

## 6. Runner-Queue-Vorfall 2026-11-12 — selektive Voll-Suiten

**Befund.** Jede MR erzeugte zwei bis drei Pipelines (Branch- *und*
MR-Event-Pipeline, plus main nach Merge). Von 100 letzten Pipelines: 50
pending (großteils für bereits gemergte Refs), 33 manuell gecancelt, 11
failed, 4 success. Der Runner (`av-docker`, Docker auf einem gemeinsam
genutzten Arbeitsrechner, `concurrent=1`, CPU-/RAM-Cap) arbeitete die Queue
nicht ab, während der Host ohnehin zwei Drittel seines RAM mit vollem zram
belegt hatte (Hub, Agenten-Sessions, Factory-Runner, Desktop-Browser). Ergebnis:
Swap-Thrash, System-Freezes — kein Kernel-OOM (0 Kills seit 10/2026),
das System friert vorher ein. Bekanntes Schwesterbild: BUG-0111
(Playwright-Worker-Zahl schoß den Nutzer-Browser ab → seitdem 2 lokal,
1 in CI).

**Maßnahmen (2026-11-12, umgesetzt):**

1. `workflow:rules` dedupliziert: Branch-Pipelines mit offenem MR laufen
   nie (`CI_OPEN_MERGE_REQUESTS`); die MR-Pipeline ist die eine Wahrheit.
2. `e2e` und der neue Eigen-Job `k8` (Lasttest aus `verify` herausgelöst)
   laufen nur noch, wenn Code-Pfade geändert sind (`rules:changes` über
   `apps/`, `packages/`, `e2e/`, `scripts/`, Lock-/Config-Dateien). Reine
   Doku (docs/, bugs/, epics/, *.md) zahlt keine 21,7-min-E2E und keinen
   Lasttest. main läuft immer voll — Merge-Ergebnis bleibt fully gated.
3. Queue-Hygiene: 50 stale Pending storniert; Pipeline-Cancel/Retry nur
   per numerischer Pipeline-ID (IID gibt 404).

**Dauer- und Ressourcendaten (Belege aus 2026-11-12):** verify ≈ Vitest
1808 Tests + Checks ≈ Minutenbereich, 6-GB-Cap greift; e2e 496 Fälle
21,7 min (je Worker-Paar Hub+Chromium ≈ 1,2 GB); K8 20 × 30 ev/s × 10 s
on top; lokal: lint ~10 s, typecheck ~20 s, PWA-Build ~3 s, Einzel-Spec
E2E 1–2 s/Test nach Boot. Regel: lokal betroffene Packages testen,
`npm run gate` nur vor Bugfix-/Epic-MRs, vollständiges E2E nur bei
UI-/Routen-/SessionManager-/Adapter-Änderungen (AGENTS.md).
