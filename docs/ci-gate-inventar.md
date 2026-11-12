# CI-Gate-Inventar und Fehlerklassifikation

Stand: 05.11.2026 · Epic: [EPIC-P28](../epics/EPIC-P28-reproduzierbare-ci.md) ·
ADR: [ADR-0049](adr/0049-selbstverwalteter-ci-runner.md) · Betrieb:
[CI-Runbook](ci-runbook.md)

Dieses Inventar ordnet jedem lokalen Gate-Teilkommando einen ausführbaren
CI-Job zu (AC-P28-1). Ein Job gilt nur als erbracht, wenn er real lief:
`ci_quota_exceeded` und nie gestartete Jobs sind kein Nachweis, Skips sind
keine Pässe. Die Fehlerklassifikation trennt Infrastruktur- von
Produktfehlern anhand konkreter Job-IDs und Commit-SHAs.

## 1. Gate-Inventar: lokal → CI

Lokales Gate ist `npm run gate` (package.json) plus PWA-Build und K8-Lasttest
(AGENTS.md). Die CI stellt jedes Teilkommando in genau einem Job ausführbar:

| Lokales Teilkommando | CI-Job | Nachweis/Report |
|---|---|---|
| `npm run check:workspace-links` | `verify` | Job-Log, Exit-Code |
| `npm run typecheck` (Root + PWA) | `verify` | Job-Log, Exit-Code |
| `npm run lint` | `verify` | Job-Log, Exit-Code |
| `npm run check:commits` | `verify` | Job-Log (Anzahl geprüfter Commits) |
| `npm run check:arch` (depcruise) | `verify` | Job-Log, Exit-Code |
| `npm run check:adapter-matrix` | `verify` | Job-Log, Exit-Code |
| `npm test` (vitest) | `verify` | `test-results/vitest-junit.xml` (Artefakt, 14 Tage) |
| `npm -w @ancientvoid/pwa run build` | `verify` | Job-Log, Exit-Code |
| `npm run loadtest` — K8: 20 Sessions × 30 ev/s × 10 s | `k8` (eigener Job seit 2026-11-12; nur bei Code-Änderungen, main immer) | Job-Log (Events, Verluste, RSS) — volle Messlatte, nicht entschärft |
| `npm run test:e2e` (Playwright Chromium) | `e2e` | `test-results/e2e-junit.xml`, `playwright-report/`, Skip-Bericht `ci-artifacts/e2e-report.md` (Artefakte, 14 Tage) |

Regeln:

- **Kein grünes Dach über fehlendem Job:** Pipelines, in denen `verify` oder
  `e2e` fehlt oder nie gestartet ist (`ci_quota_exceeded`), sind kein
  Abschlussnachweis. Abgebrochene oder veraltete Pipelines zählen nicht.
- **Skip-Sichtbarkeit:** Der E2E-Job erzeugt nach jedem Lauf einen Bericht
  (`scripts/ci-e2e-report.mjs` → `ci-artifacts/e2e-report.md`) mit SHA,
  Runner, Zählern und benannten Skips. Fehlt die JUnit-Datei oder enthält
  sie null Tests, schlägt der Bericht fehl — versehentlich fehlende Tests
  oder ein fehlender Browser blockieren die Aussage „grün“.
- **Retries** nur für klassifizierte Infrastrukturfehler (siehe unten);
  der erste Fehlversuch bleibt als Job in der Pipeline sichtbar.

## 2. Runner- und Versionsstempel

Jeder Nachweis nennt SHA, Runner-Image und Tool-Versionen
(`node --version`, `npm --version`, Playwright-Version aus dem Lockfile).
Jobs laufen auf dem Projekt-Runner `av-docker` (ADR-0049) im Image
`node:26` mit kurzlebigen Build-Containern; `npm ci` bindet das
`package-lock.json`. Der Runner hält keine produktiven Credentials und
mountet weder `data/` noch Docker-Socket in die Jobs.

## 3. Fehlerklassifikation (T28.1, erhoben am 05.11.2026)

Datenbasis: GitLab-API (Jobs/Pipelines des Projekts), Namespace-Quota,
Job-Traces. Klassifiziert werden die fehlgeschlagenen Läufe, die P27 am
05.11.2026 hinterlassen hat, plus die historically letzten echten Läufe.

### Klasse A — Infrastruktur: Kontingent erschöpft (`ci_quota_exceeded`)

| Job | Pipeline | Commit | Befund |
|---|---|---|---|
| 17784041304 (`verify`), 17784041305 (`e2e`) | [3033543422](https://gitlab.com/SiLenT_Tz/AncientVoid/-/pipelines/3033543422) (MR !293) | `28fb33db` | `failure_reason: ci_quota_exceeded`, `duration: null` — nie gestartet |
| 17784155629/30 | [3033557717](https://gitlab.com/SiLenT_Tz/AncientVoid/-/pipelines/3033557717) (main) | `db39814e` | wie oben |
| 17784245248/49 | [3033569629](https://gitlab.com/SiLenT_Tz/AncientVoid/-/pipelines/3033569629) (main, HEAD) | `f42b1375` | wie oben; jeder Push seither |
| 17780335324 (`e2e`) | MR !293-Vorlauf | `4d7374e2` | Sonderfall: lief 26:08 min, wurde **während des Laufs** von der Quota abgebrochen — Zähler stand schon auf überschritten |

Namespace-Quota `SiLenT_Tz` am 05.11.2026: **499 verbraucht / 400
Monatsminuten** (Free-Tier), `purchased_minutes_used: 0`. Runner-Bestand:
ausschließlich Shared-Runner (`instance_type`), kein Projekt-Runner.

- **Ursache:** Monatskontingent der gitlab.com Free-Stufe aufgebraucht
  (allein der E2E-Job kostet ~25–30 min pro Pipeline). Kein Produktfehler.
- **Repro:** `glab api namespaces/SiLenT_Tz` → `ci_minutes_usage`;
  beliebiger Push löst eine Pipeline aus, deren Jobs sofort mit
  `ci_quota_exceeded` und ohne Dauer enden.
- **Verantwortlich:** Betrieb (Kontingent-/Runner-Entscheidung), nicht der
  Code. Behoben durch ADR-0049 (eigener Projekt-Runner, keine Kontingent-
  Abhängigkeit); monatlicher Reset wäre erst am 01.12.2026 wirksam gewesen.

### Klasse B — Produktfehler: E2E `script_failure` (real gelaufen)

| Job | Pipeline/Commit | Ergebnis |
|---|---|---|
| 17780103820 | `dff19b9d` (docs/p27-resume-contract) | E2E rot, mehrere der unten genannten Tests |
| 17780111474 | `b8f50c43` (main) | 7 failed / 2 skipped / 276 passed (27,2 min) |
| 17780152010 | `4d7374e2` (MR !293-Vorlauf) | 6 failed / 2 skipped / 287 passed (22,6 min) |

Fehlgeschlagene Tests (über alle drei Läufe konsistent):
`desktop.spec.ts:36` (Taste vor Ausführung geprüft → BUG-0090),
`fleet.spec.ts:116` mobil+desktop (eigenes Fleet-Label → BUG-0089),
`fleet.spec.ts:169` (Host-Ausfall-Ansicht), `messlauf-p8.spec.ts:19`
(Übersicht 20 Sessions/drei Hosts), `pause-queue.spec.ts:65`
(Steer-Timeout-Rennen → BUG-0091), `session-scroll.spec.ts:18`
(Mausrad-Mitlaufen → BUG-0043).

- **Ursache:** Echte Produkt-/Testfehler, die lokal (andere Timing-/Umgebungs-
 bedingungen) nicht auftraten. P27 hat sie als CI-Blocker klassifiziert und
  in !294–!297 (!294 BUG-0089, !295 BUG-0090, !296 BUG-0091, !297 BUG-0043)
  behoben — mit lokalem Repro je Fix.
- **Lücke:** Diese Fixes konnten **nie** in der CI verifiziert werden, weil
  die Quota unmittelbar danach (17:32 UTC) endete. Die letzte vollständig
  grüne Pipeline stammt vom **09.10.2026** (2931151763, MR !181).
- **Repro:** Job-Trace bzw. Playwright-Artefakte der obigen Jobs (14 Tage
  aufbewahrt); lokal über `npx playwright test e2e/specs/<spec>.ts`.
- **Verantwortlich:** Produktseite. Nachweis der Fixes erfolgt durch die
  grünen `e2e`-Läufe auf dem Projekt-Runner (Abschnitt 5).

### Klasse C — Setup-/Umgebungsfehler (script_failure, kurz)

| Job | Commit | Befund |
|---|---|---|
| 17780092600 (`verify`) | `dff19b9d` | schlug nach 38 s fehl (Setup-Phase), während derselbe Commit im Folgejob 17780103819 nach 5:33 min grün lief |

- **Ursache:** Flüchtiger Umgebungsfehler beim Paket-/ image-Setup des
  Shared-Runners (transient). Nicht reproduzierbar; identischer Commit lief
  im unmittelbar nächsten Lauf grün. Solche Einzelereignisse rechtfertigen
  kein Retry-Konzept für Produktfehler — Retry nur nach Klassifikation.
- **Verantwortlich:** Infrastruktur (Shared-Runner-Anbieter), beobachten.

### Abgrenzung Skips (keine Pässe)

Die zwei dauerhaften Mobile-Handoff-Skips (Desktop-Gegenstücke laufen) sind
im E2E-Bericht namentlich aufgeführt und werden nirgends als Pass gezählt
(fortgesetzt aus P27, `docs/testing-e2e.md`).

## 4. Entscheidung über die Ausführungsform

ADR-0049 entscheidet: selbstverwalteter GitLab-Runner im Docker auf dem
Arbeitsplatzhost (Betriebsentscheidung des Nutzers vom 05.11.2026), kein
Public-Mirror, kein Minutenkauf. Vergleich der Optionen (Kosten, Wartung,
Tailnet, Secrets, Ausfall) und die Betriebsverantwortung stehen im ADR;
die externe Einrichtung folgt erst nach dieser Entscheidung (Reihenfolge
eingehalten).

## 5. Nachweislauf-Register (drei aufeinanderfolgende grüne Läufe)

Am finalen Code-Stand `8895473` (06.11.2026), ohne manuelles Reparieren
dazwischen; der Runner läuft bewusst ohne Cache — jeder Lauf ist ein
Kaltlauf:

| # | Pipeline | verify | e2e | Ergebnis |
|---|---|---|---|---|
| 1 | [3034503993](https://gitlab.com/SiLenT_Tz/AncientVoid/-/pipelines/3034503993) | 17791487079 | 17791487080 | grün (272 s / 1437 s) |
| 2 | [3034576007](https://gitlab.com/SiLenT_Tz/AncientVoid/-/pipelines/3034576007) | 17791961090 | 17791961091 | grün (273 s / 1412 s) |
| 3 | [3034631425](https://gitlab.com/SiLenT_Tz/AncientVoid/-/pipelines/3034631425) | 17792342051 | 17792342052 | grün (357 s / 1403 s) |

Negativproben (Wegwerf-Branches, danach gelöscht; „sauberer Commit erneut“
= Lauf 1 der Tabelle):

- Absichtlich roter Test: [3034156367](https://gitlab.com/SiLenT_Tz/AncientVoid/-/pipelines/3034156367)
  — verify 17788907093 `script_failure` durch den Probetest, e2e skipped.
- Fehlender Chromium: [3034156417](https://gitlab.com/SiLenT_Tz/AncientVoid/-/pipelines/3034156417)
  — verify grün, e2e 17788907283 `script_failure` („Executable doesn’t
  exist“, 284 failed/8 passed), kein stiller Skip.

Vorgängerläufe mit den gefundenen und behobenen Defekten (BUG-0092–0096,
Cache-Pollution, Berichts-Zählung) stehen im
[Epic-Abschluss](../epics/EPIC-P28-reproduzierbare-ci.md).
