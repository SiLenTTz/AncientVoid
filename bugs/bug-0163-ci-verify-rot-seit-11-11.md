---
id: BUG-0163
slug: ci-verify-rot-seit-11-11
status: open
severity: S2
area: ci
instance: ci
commit: "75f79259a24981e050045691fe6c4ebaec2960c9"
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/66"
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
