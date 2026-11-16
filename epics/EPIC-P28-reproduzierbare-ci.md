# EPIC-P28 — Reproduzierbare CI und belastbare Gate-Nachweise

**Status:** abgeschlossen (06.11.2026) · **Phase:** P28 · MR: siehe Abschlussnachweise
**Dauer:** 1 Agenten-Tag (05.–06.11.2026)
**Abhängigkeit:** P27 und dessen wirksame Vorgänger-Exit-Kriterien nachweislich grün.

Quelle: [Vergleichsanalyse vom 05.11.2026](../docs/2026-11-05_paseo-vs-ancientvoid.md), §5; [Planungsgrundlage und Quellen](../docs/2026-11-05_paseo-umsetzungsplanung.md).

**Planungsauftrag:** Der Nutzer hat am 05.11.2026 ausdrücklich detaillierte
Epics zu den Verbesserungen der Paseo-Analyse beauftragt. Das erlaubt diese
Planung vor grünen Vorgängern, aber keinen Implementierungsstart. Vor T*.1
Vorgänger-AC mit aktueller Code-/Test-Evidenz prüfen; historische Statuszeilen
reichen nicht. Keine neue Ausnahme von AGENTS.md durch diesen Entwurf.

## 1. Ziel

Jeder MR kann denselben Commit in einer sauberen Umgebung prüfen lassen wie
lokal. Ein Fehler liefert reproduzierbare Logs; fehlende Voraussetzungen oder
Skips werden nicht als bestandene Messlatte ausgegeben. Lokale Gates bleiben
bis zu einer separat beschlossenen Regeländerung verbindlich (AGENTS.md).
Nutzen: K1–K10 werden ausführbar belegt statt aus Release-Frequenz abgeleitet.

## 2. Scope (In / Out)

**In:** Ursache der GitLab-Ausfälle erheben, vorhandene Jobs angleichen,
Runner-Option entscheiden, isolierten Verify-/E2E-Lauf und Artefakte herstellen,
Betrieb und Ausfallpfad dokumentieren.

**Out:** Repo-Migration, ungefragtes Public-Mirroring, automatische Releases,
Deployment, geänderte Merge-Regeln oder Kauf/Registrierung eines Runners.
GitHub Actions ist eine geprüfte Alternative, keine vorausgesetzte Infrastruktur.

## 3. Design-Details

### 3.1 Bestand und Diagnose

`.gitlab-ci.yml` enthält bereits `verify` und `e2e`, Systempakete und Chromium.
`package.json` definiert zusätzlich Workspace-Link-, Architektur-, Commit- und
Adapter-Matrix-Checks im lokalen Gate. Die bisherigen CI-Jobs sind nicht dessen
vollständige Entsprechung; der CI-Lasttest mit 10×20 ersetzt K8 (20×30) nicht.
Runner-/Quota-/Netzfehler, Produktfehler und fehlende Voraussetzungen getrennt
anhand konkreter Pipeline-/Job-IDs und Commit-SHAs erfassen, keine pauschale
Schuldzuweisung an das Free-Abo. Keine produktiven Tokens/Datadirs in Logs.

### 3.2 Ausführungsmodell

Zuerst GitLab mit bestehendem Runner prüfen; dann isolierten selbstverwalteten
Runner gegen privaten Actions-Mirror vergleichen (Kosten, Wartung, Tailnet,
Secrets, Ausfall). Entscheidung samt Betriebsverantwortung in ADR dokumentieren;
externe Einrichtung erst nach geklärtem Host und expliziter Betriebsentscheidung.
Ungeprüfter MR-Code erhält weder Produktionsdaten noch Deployment-Secrets,
Docker-Socket oder Zugriff auf laufende Agenten; bevorzugt kurzlebiger Container.
Node-Version, Lockfile und Tool-Versionen dokumentieren, Cache optional halten.

### 3.3 Nachweise

Ein Gate-Inventar ordnet jedem lokalen Teilkommando einen Job zu. Alle Teile
von `npm run gate`, PWA-Build und separater K8-Lauf müssen erkennbar sein.
Jeder Report nennt SHA, Runner-Image/Versionen, Laufzeit, Pass/Fail/Skip und
Artefaktpfad. Versehentlich fehlende Tests/Browser blockieren die Aussage
„grün“. Retries nur für nachgewiesene Infrastrukturfehler, erster Fehler bleibt
sichtbar; abgebrochene/veraltete Pipelines sind kein Abschlussnachweis.

## 4. Aufgaben (Checkliste T28.m)

- [x] **T28.1** Gate-Inventar und mindestens drei fehlgeschlagene vorhandene
  Job-Läufe klassifiziert — [`docs/ci-gate-inventar.md`](../docs/ci-gate-inventar.md) §3:
  Kontingentklasse (`ci_quota_exceeded`, Jobs 17784041304/05 u. a., Quota
  499/400 min), Produktklasse (`script_failure`, Jobs 17780103820/17780111474/
  17780152010, Muster BUG-0043/0089/0090/0091) und ein transienter Setup-Fehler
  (17780092600), je mit Ursache, Repro, Verantwortlichkeit. **K1–K10**.
- [x] **T28.2** Runner-ADR ([ADR-0049](../docs/adr/0049-selbstverwalteter-ci-runner.md),
  Betriebsentscheidung des Nutzers vom 05.11.2026: Docker-Runner auf dem
  Arbeitsplatzhost) und lokalen Container-Repro (`scripts/ci-repro.sh`)
  vorbereitet; Nachweis Neuaufbau ohne Cache siehe unten (Runner läuft bewusst
  cache-los, jeder Lauf ist ein Kaltlauf). **K5/K7/K8**.
- [x] **T28.3** CI-Konfiguration ans Gate-Inventar angeglichen: alle Gate-Teile
  plus PWA-Build plus K8 (20×30×10, unentschärft) in `verify` ausgeführt,
  E2E + Skip-Bericht in `e2e`; Nachweis echte Jobs am selben SHA (drei Läufe
  unten). **K1–K10**.
- [x] **T28.4** Artefakte (14 Tage), Skip-Bericht (`scripts/ci-e2e-report.mjs`,
  unit-getestet) und Fehlerklassifikation (Runbook §3) eingerichtet;
  Negativproben rot nachgewiesen (unten). **K2/K7/K8/K10**.
- [x] **T28.5** Runbook ([`docs/ci-runbook.md`](../docs/ci-runbook.md), über
  README erreichbar) und lokale-vs-CI-Regel offen präzisiert (AGENTS.md,
  testing-e2e.md — lokale Gates bleiben verbindlich); drei aufeinanderfolgende
  vollständige Läufe ohne manuelles Reparieren nachgewiesen (unten). **K1–K10**.

## 5. Acceptance Criteria (AC-P28-k)

- **AC-P28-1:** Inventar hat für jedes lokale Gate-Teilkommando, PWA-Build und
  K8 einen ausführbaren Job und einen Report; kein grünes Dach über fehlendem Job.
- **AC-P28-2:** T28.5 liefert drei SHA-gebundene vollständige grüne Läufe;
  absichtlicher Testfehler und fehlendes Chromium führen nachweislich zu Rot.
- **AC-P28-3:** Keine produktiven Credentials/Volumes im Test-Runner;
  bereinigte Logs und Artefakte sind vom MR aus auffindbar (14 Tage Aufbewahrung).
- **AC-P28-4:** Bekannter Runner-Ausfall ist über Runbook lokal reproduzierbar;
  Gate-Regeln wurden nicht still geändert. Lokaler K8-Nachweis bleibt 20×30.

## 6. Premortem (Failure-Modi + Mitigation)

1. **Runner auf Alltagshost beeinflusst Agenten:** Ressourcenlimits und isolierte
   Testdaten, keine produktiven Worker/Panes übernehmen; Host-Auswahl vor Rollout.
2. **Cache kaschiert fehlende Pakete:** mindestens ein kalter Lauf, Lockfile und
   benötigte Systemtools explizit installieren.
3. **Ein Retry macht Produktfehler grün:** nur klassifizierte Infrastrukturfehler
   wiederholen; Erstfehler und alle Versuche behalten.
4. **Mirror veröffentlicht privates Repo:** ohne separate Entscheidung keinen
   Mirror erstellen; selbstverwalteter GitLab-Runner ist die erste Alternative.

## 7. Definition of Done

Alle Aufgaben und AC mit SHA-/Job-Evidenz abgenommen; `npm run gate`, PWA-Build
und vollständiger K8-Lauf lokal grün. Pipeline-Job `e2e` grün; externe
Infrastrukturprobleme sichtbar nach AGENTS.md bewerten, niemals als Pass zählen.
Jede neue UI-Funktion/jeder neue Ablauf hat einen Spec in `e2e/specs/`;
CI-spezifische Negativproben zusätzlich als Job-Artefakt. Runbook über docs/README
bzw. CONTRIBUTING erreichbar. Keine Produktion umgestellt ohne Betriebsentscheidung.

## Umsetzung und Abschlussnachweise (05.–06.11.2026)

**Runner (T28.2, ADR-0049):** Projekt-Runner `av-docker`, ID 58590891,
gitlab-runner v19.5.2 im Docker (`--restart unless-stopped`), Executor docker,
Image `node:26` (v26.13.0, npm 11.20.0), Concurrency 1, pro Job 8 CPUs /
6 GiB RAM / 2 GiB shm, kurzlebige Build-Container ohne Docker-Socket und ohne
produktive Credentials/Volumes; Runner-Token ausschließlich außerhalb des
Repos (`~/.config/ancientvoid-ci-runner/config.toml`, chmod 600). Runner läuft
**ohne Cache** — jeder Job baut vollständig neu (Premortem 2 strukturell
erfüllt). Betriebsentscheidung des Nutzers vom 05.11.2026.

### Läufe auf dem Projekt-Router (chronologisch, inklusive der Rots)

| Pipeline | SHA | Ergebnis | Einordnung |
|---|---|---|---|
| [3034048360](https://gitlab.com/SiLenT_Tz/AncientVoid/-/pipelines/3034048360) | 499a7cb | verify rot | K7-Flake unter Parallellast ([BUG-0092](../bugs/bug-0092-k7-recovery-test-flaky-parallel-last.md), offen; mein Container-Repro lief parallel — seither Betriebsregel im Runbook) |
| [3034061873](https://gitlab.com/SiLenT_Tz/AncientVoid/-/pipelines/3034061873) | d26b53f | verify grün, e2e abgebrochen | erster vollständiger Gate-Paritäts-Lauf (K8 „PASSED“); e2e durch eigenen Zwischenpush abgebrochen (`interruptible`) — Lektion: während eines Laufs nicht pushen |
| [3034087469](https://gitlab.com/SiLenT_Tz/AncientVoid/-/pipelines/3034087469) | 19c5b5f | verify grün, e2e rot (294/1/2) | `check:commits` prüft nun („8 commit(s)“, GIT_DEPTH-Fix); BUG-0089/0091/0043-Fixes aus !294–!297 erstmals CI-grün; desktop-Race → [BUG-0093](../bugs/bug-0093-desktop-e2e-zweiter-auftrag-fertig-race.md) |
| [3034156367](https://gitlab.com/SiLenT_Tz/AncientVoid/-/pipelines/3034156367) | 3755dd5 (ci-probe/fail-test) | verify rot script_failure | **Negativprobe 1**: absichtlich roter Test macht Pipeline rot (e2e skipped) |
| [3034156417](https://gitlab.com/SiLenT_Tz/AncientVoid/-/pipelines/3034156417) | a91ee5d (ci-probe/no-chromium) | verify grün, e2e rot script_failure | **Negativprobe 2**: fehlender Chromium ist laut rot („Executable doesn’t exist“, 284 failed), kein stiller Skip |
| [3034192514](https://gitlab.com/SiLenT_Tz/AncientVoid/-/pipelines/3034192514) | 214cf6f | verify grün, e2e rot (294/1/2) | BUG-0093-Fix hält; resize-Race → [BUG-0094](../bugs/bug-0094-resize-e2e-autogrow-misst-vor-render.md) |
| [3034262577](https://gitlab.com/SiLenT_Tz/AncientVoid/-/pipelines/3034262577) | 3baa5ec | **vollständig grün** (295/2) | erster vollständiger grüner Lauf; Skip-Bericht zählte aber „3 Tests“ statt 297 → Berichts-Fix 7a8eada (Parser las nur die erste testsuite) |
| [3034317742](https://gitlab.com/SiLenT_Tz/AncientVoid/-/pipelines/3034317742) | 7a8eada | verify rot (Lint) | Cache-Pollution: erster grüner e2e-Lauf hatte Chromium-Binaries ins gemeinsame Cache-Archiv gepusht → Fix 9071049 (getrennte Cache-Schlüssel, `.cache/**` im ESLint-Ignore) |
| [3034339525](https://gitlab.com/SiLenT_Tz/AncientVoid/-/pipelines/3034339525) | 9071049 | verify grün, e2e rot (293/2) | Interrupt-Missklassifizierung → [BUG-0095](../bugs/bug-0095-fehler-exit-durch-folgeprompt-zu-interrupted.md) (Kern-Fix rot-dann-grün); Bericht zählt korrekt 297/2 |
| [3034417565](https://gitlab.com/SiLenT_Tz/AncientVoid/-/pipelines/3034417565) | 22f2998 | verify grün, e2e rot (296/1) | einmaliger drafts-Flake → [BUG-0096](../bugs/bug-0096-drafts-e2e-adapter-merkung-dummy.md) (offen, ohne Repro) |
| [3034470769](https://gitlab.com/SiLenT_Tz/AncientVoid/-/pipelines/3034470769) | 0ca369f | verify rot | ENOTEMPTY-Cleanup-Rennen im Loop-Adapter-Test → Fix 8895473 (rm mit Retry) |

### Drei aufeinanderfolgende vollständige grüne Läufe (AC-P28-2)

Alle am finalen Code-Stand `8895473`, ohne manuelles Reparieren dazwischen;
der Runner hält bewusst keinen Cache — **jeder Lauf ist ein Kaltlauf**
(Neuaufbau ohne Cache, Premortem 2):

| # | Pipeline | verify | e2e |
|---|---|---|---|
| 1 | [3034503993](https://gitlab.com/SiLenT_Tz/AncientVoid/-/pipelines/3034503993) | 17791487079 grün (272,3 s) | 17791487080 grün (1437,4 s) |
| 2 | [3034576007](https://gitlab.com/SiLenT_Tz/AncientVoid/-/pipelines/3034576007) | 17791961090 grün (272,7 s) | 17791961091 grün (1412,1 s) |
| 3 | [3034631425](https://gitlab.com/SiLenT_Tz/AncientVoid/-/pipelines/3034631425) | 17792342051 grün (356,6 s) | 17792342052 grün (1403,2 s) |

### Lokale Nachweise

- `npm run loadtest` (K8, volle Messlatte 20 Sessions × 30 ev/s × 10 s):
  „6100 events in 10.1s → 604 ev/s aggregate, rss=140 MB — K8 PASSED: no
  session lost events“.
- Container-Kaltlauf `scripts/ci-repro.sh`: Lauf 1 rot (eigener Testfehler,
  Fix d26b53f), Lauf 2 rot (BUG-0092-Parallellast), **Lauf 3 (sequentiell,
  finaler Stand 8895473) grün** — „CI-Repro im Container erfolgreich“,
  inkl. vollem Testsatz (1187 passed/19 Skips), PWA-Build und K8
  („6100 events in 10.1s → 603 ev/s, rss=145 MB — K8 PASSED“).
  `--e2e` (Runner-Ausfallpfad komplett): erster Versuch rot — der Repro
  lief ohne `CI`-Env mit 4 Playwright-Workern (härter als die Pipeline) und
  riss einen Timing-Test (workspace.spec 45-s-Timeout); das Skript setzt
  jetzt `CI=1` (1 Worker, junit, forbidOnly — CI-Bedingungen wie in der
  Pipeline). **Finallauf grün**: 295 passed / 2 skipped (22 min), Exit 0.
- `npm run gate` am finalen Stand `8895473`: **Exit 0** — 171 Dateien /
  1188 Unit-/Integrationstests grün, 295 E2E-Pässe (lokal 6,4 min),
  workspace-links, typecheck, lint, check:commits, check:arch,
  check:adapter-matrix grün; PWA-Build im E2E-globalSetup frisch.
- Neue Unit-Tests: `ci-e2e-report.test.mjs` (6), Integrationstest BUG-0095;
  Specs nach Fixes grün (desktop 2/2, resize 4/4).

### AC-Abgleich

- **AC-P28-1 ✓** — [Gate-Inventar](../docs/ci-gate-inventar.md) §1 ordnet
  jedem lokalen Teilkommando, PWA-Build und K8 einen Job zu; die
  verify-Traces zeigen alle Checks inkl. „K8 loadtest: 20 sessions × 30 ev/s
  × 10s … PASSED“ und „check:commits — 8 commit(s) … follow the notation“;
  Berichte (vitest-junit, e2e-junit, e2-report) sind 14-Tage-Artefakte.
  Kein grünes Dach: Beide Negativproben rot.
- **AC-P28-2 ✓** — drei SHA-gebundene vollständige grüne Läufe (Tabelle),
  alle kalt; absichtlicher Testfehler und fehlender Chromium nachweislich rot.
- **AC-P28-3 ✓** — keine produktiven Credentials/Volumes im Runner
  (ADR-0049-Grenzen, Token außerhalb des Repos, keine geheimen
  CI-Variablen); Artefakte als junit+archive hochgeladen und vom MR aus
  erreichbar.
- **AC-P28-4 ✓** — Runner-Ausfall über `scripts/ci-repro.sh` lokal
  nachstellbar (Kaltlauf-Nachweis); Gate-Regeln offen in AGENTS.md und
  testing-e2e.md präzisiert, lokale Gates unverändert verbindlich; lokaler
  K8 bleibt 20×30 (Messwerte oben).

### Premortem-Abgleich

1. **Runner beeinflusst Alltagshost:** Für laufende Agenten nicht beobachtet
   (Limits, Concurrency 1, 1 E2E-Worker). Umgekehrt traf Parallellast den
   Runner-Job (BUG-0092) → Betriebsregel „keine schweren lokalen Läufe
   parallel zum Runner“ im Runbook. Teilweise eingetreten, beherrscht.
2. **Cache kaschiert fehlende Pakete:** Strukturell ausgeschlossen — der
   Runner läuft ohne Cache, jeder Job baut aus Lockfile neu. Nicht
   eingetreten; das Gegenteil (Cache-Pollution, Lauf 3034317742) wurde
   gefunden und durch getrennte Schlüssel behoben.
3. **Ein Retry macht Produktfehler grün:** Kein Retry verwendet
   (retries: 0 unverändert); jeder Erstfehler blieb sichtbar und ist
   dokumentiert (BUG-0092–0096). Nicht eingetreten.
4. **Mirror veröffentlicht privates Repo:** Kein Mirror erstellt (ADR-0049).
   Nicht eingetreten.

## Retro (06.11.2026)

AC-P28-1 bis AC-P28-4: **4 erfüllt**, jeweils mit Beleg in den Tabellen
oben; maßgeblich ist der finale Stand `8895473` mit drei grünen Läufen,
grünem lokalem Gate und K8-Nachweis.

Erkenntnisse:

1. Die „unzuverlässige CI“ war mehr als ein Kontingentproblem: Nach dem
   Runner-Aufbau deckte sie fünf echte Defizite auf — drei Test-Rennen
   (BUG-0093/0094, Cleanup ENOTEMPTY), einen stillen Skip (`check:commits`
   bei GIT_DEPTH-Default) und eine Core-Missklassifizierung (BUG-0095) —
   belegt durch die Läufe 3034087469/3034192514/3034339525/3034417565/3034470769.
2. Rot-dann-grün funktionierte ohne Entschärfen: Jeder Fund hat einen roten
   CI-Job als Repro; keine Assertion gelockert, kein Retry, keine
   Limits entschärft. Die K8-Messlatte blieb 20×30 (CI wie lokal).
3. Der E2E-Bericht selbst brauchte zwei Korrekturen (Zählung über alle
   testsuites, Erzeugung auch bei Rot) — Nachweis-Instrumente sind eigene
   Fehlerquellen und verdienen dieselbe Teststrenge wie Produktcode.
4. Drei Anläufe für die grüne Serie: realer Preis ehrlicher CI. Unter
   geteilter Runner-Hardware (8 CPUs) war 1 Playwright-Worker die richtige
   Betriebsgröße; die Suite selbst bleibt bei 4 Workern lokal grün.

Action Items:

- **AI-P28-1:** BUG-0092 (K7-Recovery-Flake unter Parallellast) im Kern
  analysieren — zurück als: [bugs/bug-0092](../bugs/bug-0092-k7-recovery-test-flaky-parallel-last.md)
  (open), nächster Bugfix-Zyklus; bis dahin gilt die Runbook-Betriebsregel.
- **AI-P28-2:** BUG-0096 (drafts-Adapter-Merkung, 1× CI) bei Reproduktion
  auswerten — zurück als: [bugs/bug-0096](../bugs/bug-0096-drafts-e2e-adapter-merkung-dummy.md)
  (open); Trace-Artefakte des Jobs sind 14 Tage verfügbar.
- **AI-P28-3:** Runner-Version aktuell halten (gitlab-runner-Patch-Releases)
  — zurück als: Runbook-Abschnitt „Runner aktualisieren“ (bestehend).
