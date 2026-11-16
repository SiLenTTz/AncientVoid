---
id: BUG-0163
slug: ci-verify-rot-seit-11-11
status: in-progress
severity: S2
area: ci
instance: ci
commit: "75f79259a24981e050045691fe6c4ebaec2960c9"
forge: "https://github.com/SiLenTTz/AncientVoid/issues/4"
epic: "EPIC-P60 (AI-P60-1)"
created: 2026-11-14
reporter: "P60-Abschluss-Retro"
---

# BUG-0163 — CI: `verify` rot seit dem 11.11.2026 (4 Umgebungstests), lokal grün

## Gesehen

Jede Pipeline seit dem 11.11.2026 (einschließlich main) scheitert im Job
`verify` mit denselben vier Tests; lokal laufen alle vier grün. Merges
seitdem nur mit dokumentiertem Infra-Fall möglich.

## Erwartet

`verify` ist auf main grün; ein Commit, der lokal `npm test` grün hat,
scheitert nicht an Tests, die ausschließlich in der Runner-Umgebung rot
sind.

## Repro (gesehen: CI-Job-Trace, 14.11.2026)

Voraussetzung: Runner `av-docker` (ADR-0049), kein weiterer lokaler Volllauf.

1. Pipeline auf main ansehen — z. B. 3068551501 (14.11. 15:59), Job
   `verify` 18033604946; gleiche vier Fehler wie im Retry 18034536607
   (17:58) und in jedem Branch seit dem 11.11.
2. Fehlende rote Tests (alle vier in jedem Lauf):
   - `packages/workers/test/tmux.test.ts` — „an old worker handle cannot
     terminate a successor with the same session name" (und teils
     „lists only ancientvoid-prefixed workers and reaps orphans")
   - `scripts/setup.test.mjs` — „zwei Checkouts auf zwei Ports starten je
     ihren eigenen Hub …" (BUG-0132)
   - `packages/core/test/modules/automations/k8.test.ts` — „128 Pläne im
     Minutentakt …" (Laufzeit in CI ~426 s vs. lokal ~60 s)
   - `packages/core/test/modules/sessions/steer-wait-timeout.test.ts` —
     „Occupant-Pinning: ein vorgemerkter Prompt wartet …"
3. Dieselbe Suite lokal (Kaltlauf im Worktree, 14.11.): `npm test` →
   2131 passed / 0 failed; alle vier Tests einzeln grün.
4. Letzte grüne Pipeline: 3054739446 (11.11. 14:26,
   feat/p43-t6-…); seitdem 0 grüne Pipelines (API-Liste, 14.11.).

## Erwartung Ursache (zur Prüfung, nicht belegt)

Zeit-/Umgebungssensibel im Runner-Container (tmux-Socket-Isolation,
Lastprofil: k8-Laufzeit 7× lokal; BUG-0132-Porttest) — nicht das
Merge-Gut. Einordnung ähnlich Runbook §6 (Queue-Vorfall 2026-11-12) und
BUG-0092 (parallele Vollläufe), aber hier reproduzierbar ohne erkennbare
Parallel-last im Runner.

## Testlücke

Kein lokales Äquivalent, das die Runner-Umgebung abbittet:
`scripts/ci-repro.sh` (Runbook §2) auf dem Arbeitsplatz-Host prüfen —
wenn der Container-Repro grün ist, während der Runner rot bleibt, ist es
Runner-spezifisch (Image/Socket/Ressourcen), sonst test-sensibel.

## Logs

Job-Trace-Auszug (Retry 18034536607): `FAIL … 4 failed | 281 passed`,
Test Files-Zeile wie oben; `failure_reason: script_failure`.

## Entscheidend für

- Jedes Epic-DoD „Pipeline-Job e2e grün" (derzeit faktisch unerreichbar).
- `glab mr merge` CLI verweigert (rot-Check), Merge nur via API —
  Verfahren seit 3 Tagen stillschweigend geübt, mit diesem Bug dokumentiert.

## Nachtrag 15.11.2026 (Veröffentlichungs-Audit)

Fix auf `main`: 03acde62/82c7abdc (`drainSlot` mit Macrotask-Yield +
Re-Check, k8 relativ zum frühen Tick, tmux-Pane-Prüfung, `iproute2` im
CI-Image). Eine Alternative (`drainSlot` wartet `session.lifecycle` ab) hielt
`steer-wait-timeout` stabil, machte aber `e2e/specs/progress.spec.ts`
„ohne Plan, mit Zughistorie“ flaky — verworfen. Status bleibt
**in-progress**, bis eine grüne CI-Pipeline den Fix belegt.
Auf einem macOS-Host mit Endpoint-Scanner (~12 ms je fsync) läuft der
k8-Test in der main-Fassung weiterhin ins 120-s-Timeout (15.11.: 1 von 2239
rot) — Umgebung, kein Produktfehler; eine fsync-abhängige Zeitbudget-Skalierung
wäre der nächste Schritt.

## Nachtrag 16.11.2026 (GitHub-gehostete Runner)

Erster verify-Lauf auf GitHub (PR #2, Run 43833945447): tmux-, setup- und
steer-wait-Tests aus dem ursprünglichen Quintett sind **grün** — die
Fixes vom 15.11. haben gehalten. Rot bleiben:

- `automations/k8.test.ts` „128 Pläne im Minutentakt …" — wieder
  120-s-Timeout (BUG-0163-Kernbefund, Hardware-Budget).
- `fleet/fleet-routing.test.ts` „starts, reads and steers …" — **kein**
  Timeout, sondern ein Dedup-Race: 2 `user`-Events statt 1 → eigener Bug
  [BUG-0168](bug-0168-fleet-steer-dedup-race-auf-langsamer-hardware.md).

Nutzerentscheid 16.11.2026: Tests, die gehostete Runner nicht
aussagekräftig fahren können, werden dort **sichtbar geskippt**
(`AV_HOSTED_RUNNER=1` in `ci.yml`, `it.skipIf`) und bleiben lokal im Gate
verbindlich. Status bleibt **in-progress**, bis eine grüne
main-Pipeline den Umfang belegt.

**e2e-Läufe (16.11., PR #13):** Lauf 1 rot durch einen echten
Test-Instrastrukturfehler — Fixture-Commit ohne Git-Identität
(`git-graph.spec.ts`, Runner haben keine globale Git-Config) — gefixt.
Lauf 2: 707/709 grün, rot nur zwei streng getaktete Regressionstests
(ebenfalls Hosted-Skip, lokal Pflicht):

- `session.spec.ts` „jedes Event erscheint genau einmal … (BUG-0023)" —
  API-Snapshot-Race: DOM zeigte Folge-Statusevent seq 19, das der Snapshot
  noch nicht hatte (±1, kein Duplikat — Kern unverändert gültig).
- `workspace.spec.ts` „BUG-0015/AC-P8-2: offline neu laden …" —
  Service-Worker-Cache hing ~2 s hinter dem Online-Stand (Zeitstempel
  11:37:15 statt 11:37:17); K10-Aussage bleibt lokal geprüft.

Gemeinsamer Mechanismus: `hostedRunner` aus `e2e/support/fixtures.ts`,
`test.skipIf(hostedRunner)`.

**main-Lauf (16.11. 12:09, nach PR #13/#15):** verify rot durch genau ein
Flake — `steer-wait-timeout.test.ts` „Occupant-Pinning: ein vorgemerkter
Prompt wartet …", eines der Original-Quartetts vom GitLab-Runner (dort
dauerhaft rot, auf GitHub in Läufen 1–2 noch grün — das Fenster schwankt
mit der Runner-Last; 2201/2239 grün). Erhält denselben Hosted-Skip,
bleibt lokal Pflicht. Damit stehen alle vier Environment-Tests des
Original-Befunds unter dem gleichen, sichtbaren Mechanismus.

**main-Lauf 2 (16.11. 12:19, nach PR #16):** verify/k8/changes grün; e2e
rot durch **5** streng getaktete/lastabhängige Specs (702/709 grün):
K2-Frame-Budget-Messlauf (beide Projekte), Voice-Esc, Accent-Overlay,
Recovery-Bild plus die ohnehin lastabhängigen P8/P26/K1-Läufe. Einzeln-
Skips konvergieren nicht — jede Suite wirft neue Fenster.
Strukturentscheid (Nutzervotum „Github packt die Tests nicht → sauber
regeln", 16.11.2026):

1. **Messlatten sind lokal-only in der e2e:** K1-p95, K2-Frame-Budget,
   P8-Lastlauf (20 Sessions × 3 Hosts), P26 (n=8) und der K7-Restore-
   Messlauf skippen auf Hosted-Runnern sichtbar (`hostedRunner` aus
   `e2e/support/fixtures.ts`) — eine Messlatte misst die Ziel-Hardware,
   nicht einen gemieteten 2-vCPU-Runner; Messwerte gehören nach
   `docs/messlauf/`.
2. **`retries: process.env.CI ? 1 : 0`** (playwright.config.ts): genau
   ein Neuversuch pro Test in CI — die von AGENTS.md erlaubte Strategie
   („benannt und einmal neu gestartet"), automatisiert. Wiederholt rot
   bleibt rot; lokal weiterhin 0 Retries.
