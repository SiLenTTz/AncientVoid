# CI-Runbook: Runner-Betrieb, Ausfallpfad, lokale-vs-CI-Regel

**Art:** how-to

Stand: 05.11.2026 · Epic: [EPIC-P28](../epics/EPIC-P28-reproduzierbare-ci.md) ·
ADR: [ADR-0049](adr/0049-selbstverwalteter-ci-runner.md) ·
Inventar: [CI-Gate-Inventar](ci-gate-inventar.md)

## 1. Runner-Betrieb (Projekt-Runner `av-docker`)

Der Runner ist ein Docker-Container auf dem Arbeitsplatzhost und meldet sich
bei gitlab.com als Projekt-Runner des Repos (ID 58590891, Tag `av-docker`,
gesperrt/`locked`, ausschließlich getaggte Jobs). Pipelines verbrauchen dadurch
**keine** Shared-Runner-Minuten.

```sh
docker ps --filter name=ancientvoid-ci-runner      # läuft er?
docker logs -f ancientvoid-ci-runner               # Job-Annahme/Fehler
docker restart ancientvoid-ci-runner
```

Konfiguration: `~/.config/ancientvoid-ci-runner/config.toml` (chmod 600,
enthält das Runner-Token, liegt **außerhalb** des Repos). Sanitisiert:

```toml
concurrent = 1
check_interval = 3

[[runners]]
  name = "av-docker"
  url = "https://gitlab.com"
  token = "<nur lokal, nie committen>"
  executor = "docker"
  [runners.docker]
    image = "node:26"
    privileged = false
    pull_policy = ["always"]
    cpus = "8"
    memory = "6g"
    memory_swap = "6g"
    shm_size = 2147483648        # 2 GiB /dev/shm für Chromium
    volumes = ["/cache"]
```

Betriebsgrenzen (ADR-0049): Jobs laufen in kurzlebigen Build-Containern
(`pull_policy: always`, Concurrency 1, CPU/RAM-Limits) — der Alltagshost
bleibt für Agenten-Sessions nutzbar. Build-Container erhalten **keinen**
Docker-Socket, kein `privileged`, keine Volumes mit produktiven Daten; das
Repo-`data/` ist git-ignored und landet nie im Job. Es gibt keine
CI-Variablen mit Secrets im Projekt.

- **Neustart nach Reboot:** Container läuft mit `--restart unless-stopped`,
  `docker.service` ist enabled — der Runner kommt nach dem Boot von selbst
  zurück. Bis dahin bleiben neue Pipelines sichtbar `pending` (ehrlich).
- **Bewusst ohne Runner-Cache:** Der Runner speichert keine Cache-Archive
  (Verzeichnis `/cache` bleibt leer); jeder Job macht ein vollständiges
  `npm ci` aus dem `package-lock.json` und lädt Chromium frisch. Das ist
  gewollt: Jeder Lauf ist damit ein Kaltlauf (EPIC-P28 Premortem 2 — ein
  Cache kann fehlende Pakete nicht kaschieren) und die Laufzeit bleibt
  ehrlich (~5 min verify, ~24 min e2e). Soll Cache später aktiviert werden,
  sind getrennte Schlüssel pro Job Pflicht (Cache-Pollution-Lektion aus
  Lauf 3034317742: Chromium-Binaries im verify-Workspace ließen `eslint .`
  über Browser-JS stolpern).
- **Keine schweren lokalen Läufe parallel zum Runner:** Der Runner teilt sich
  CPU/IO mit dem Alltagshost. Ein parallel laufender Volllauf (ci-repro,
  loadtest, komplette Testsuite) hat am 05.11.2026 zweimal den
  timing-sensiblen K7-Recovery-Test zum Scheitern gebracht
  ([BUG-0092](../bugs/bug-0092-k7-recovery-test-flaky-parallel-last.md)).
  Schwere lokale Läufe erst starten, wenn kein Build-Container aktiv ist
  (`docker ps`), oder sequentiell nacheinander.
- **Runner aktualisieren:**
  `docker stop ancientvoid-ci-runner && docker rm ancientvoid-ci-runner`,
  dann `docker pull gitlab/gitlab-runner:v<x.y.z>` und Start wie in
  ADR-0049/runbook (Version im Job-Log des Runners prüfen). Genutzte Version:
  **gitlab-runner v19.5.2**.
- **Runner abschalten (Betriebsentscheidung rückgängig):** Container stoppen
  plus `glab api -X POST runners/58590891` → `paused: true` (oder in der
  GitLab-UI). Danach gilt wieder die Kontingent-Situation aus
  [ci-gate-inventar.md](ci-gate-inventar.md) §3A.

## 2. Ausfallpfad: bekannte Runner-Ausfälle lokal reproduzieren

Ist der Runner oder GitLab nicht erreichbar (oder ist das Kontingent erschöpft,
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

## 4. Lokale-vs-CI-Regel (unverändert, nur präzisiert)

- **Lokale Gates bleiben verbindlich** (AGENTS.md):
  `npm test`, `npm run lint`, `npm run typecheck` vor jedem Commit-Vorschlag;
  `npm run test:e2e` bei PWA/Server/SessionManager/Adapter-Änderungen;
  `npm run gate` vor Bugfix-/Epic-MRs. Diese Regel wurde durch P28 **nicht**
  geändert.
- **CI liefert ab sofort verlässliche Zusatz-Evidenz:** Jeder MR zeigt am
  selben SHA `verify` (inkl. K8 20×30) und `e2e` (inkl. Skip-Bericht) auf dem
  Projekt-Runner. Die Kontingent-Ausnahme aus T12.6
  ([testing-e2e.md](testing-e2e.md)) gilt weiter, aber nur noch für echte
  Runner-/GitLab-Ausfälle — sie ist kein Freibrief für rote oder nie
  gestartete Jobs; beides ist nie ein Pass.
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
failed, 4 success. Der Runner (`av-docker`, Docker auf dem
Arbeitsplatzhost, `concurrent=1`, 8 CPUs, 6-GB-Cap) arbeitete die Queue
nicht ab, während der Host ohnehin ~21/32 GB RAM mit vollem zram belegt
hatte (Hub, Agenten-Sessions, Factory-Runner, Desktop-Browser). Ergebnis:
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
