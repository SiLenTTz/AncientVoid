---
name: pr-review
description: Structured Gate-Review mit 6 Dimensionen (Requirements blocking, Architektur, Edges, Qualität, Determinism, Future-Fragility Pflicht) und Gates npm test/lint/typecheck. Aktiv bei MR-Review, Merge-Freigabe, Handoff nach bugfix. Never self-merge.
---

# Skill: pr-review

Querschnitts-Regeln: [`AGENTS.md`](../../../AGENTS.md). Messung:
[`gates`](../gates/SKILL.md). Komplexitäts-Linse (advisory):
[`ponytail-review`](../ponytail-review/SKILL.md). AncientVoid-Verträge:
[`.claude/skills/_shared/ancientvoid-protected-invariants.md`](../_shared/ancientvoid-protected-invariants.md).

## Zweck

Ein MR wird gegen Issue/Epic-Task-AC und deterministische Gates geprüft.
Grüne Tests heben ein fehlendes Acceptance-Criterion nicht auf.
Future-Fragility ist Pflicht, kein Anhang.

## Wann benutzen (Trigger)

- „MR reviewen", Merge-Freigabe, Handoff aus `bugfix`, structured review.

**Nicht:** reines Lint (`gates`); Komplexitäts-Sweep (`ponytail-review`).

## Hard Rules

- ✅ Requirements first — Issue-/Epic-Task-AC vor Code.
- ✅ Jeder Claim durch Kommando oder named Test belegt.
- ✅ Future-Fragility **explizit** beantworten (Dimension 6).
- ✅ Gates in Reihenfolge, stoppe beim ersten Fail.
- ✅ **Zwei Achsen getrennt melden** — siehe unten.
- ❌ Never approve on green gates alone, wenn AC fehlt = 🔴.
- ❌ Never self-merge, never force-push, never merge ohne Anweisung.

### Die zwei Achsen

Ein Diff kann auf einer Achse bestehen und auf der anderen durchfallen:

- **Handwerk** — hält der Code die Konventionen dieses Repos (`AGENTS.md`,
  Contracts, Invarianten)?
- **Auftrag** — setzt der Diff um, was Issue, Epic-Task oder AC tatsächlich
  verlangt haben? Fehlende Anforderungen, halbe Umsetzungen und
  **Scope-Creep** (Verhalten, das niemand bestellt hat) sind Befunde dieser
  Achse, kein Handwerksmangel.

**Die beiden Achsen werden nie gegeneinander verrechnet und nie in eine
gemeinsame Rangfolge gebracht.** Genau so verdeckt sauberer Code eine nicht
erfüllte Anforderung — und genau so wird eine erfüllte Anforderung als
Freibrief für einen unsauberen Diff benutzt.

Findet sich keine Auftragsquelle (Issue, Epic-Task, ursprüngliche Anweisung),
lautet der Befund auf dieser Achse **„keine Vorgabe auffindbar"**. Die
Handwerksachse läuft trotzdem.

## Phasen/Prozess

### 1. Prepare

```bash
glab mr view --json title,description,source_branch,target_branch
git fetch origin
git merge origin/main
```

Merge-Konflikt gegen `origin/main` ist Blocker.

### 2. Verify — Gates

| Gate | Was | Kommando |
|---|---|---|
| 0 Requirements (blocking) | Jedes AC ↔ Code oder Test | Issue/Epic-Task vs. Diff-Matrix |
| A Tests | betroffene Packages | `npm test` |
| B Lint/Types | ESLint + tsc | `npm run lint && npm run typecheck` |
| C PWA-Build | nur bei `apps/pwa/**` | `npm -w @ancientvoid/pwa run build` |
| D Architektur | Contract-/AdapterContext-Grenzen, Invarianten | Diff + `_shared/ancientvoid-protected-invariants.md`; optional `ponytail-review` |

#### Gate E — Sekret- und Injektionsscan auf den **hinzugefügten** Zeilen

Nur `^+`-Zeilen prüfen — der Bestand ist nicht Gegenstand dieses MRs:

```bash
D="git diff origin/main...HEAD"
$D | grep "^+" | grep -inE "(api_key|secret|password|token|passwd)[\"' ]*[:=][\"' ]*[^\"' ]{6,}"
$D | grep "^+" | grep -nE "child_process\.(exec|spawn)\(" -- packages/adapters/*/src
$D | grep "^+" | grep -nE "\beval\(|\bnew Function\("
```

Zusätzlich AncientVoid-spezifisch: prüfen, ob irgendein neuer Code Agenten-Output
(Event-`payload`, `summary`) als Instruktion interpretiert statt als Daten
rendert — das ist die Prompt-Injection-Grenze aus `AGENTS.md`
("Datadir & Sicherheit"). Jeder Treffer ist ein Befund der Handwerksachse —
auch wenn er erklärbar ist.

### 3. Sechs Dimensionen

1. **Requirements-Fit (blocking)** — jedes AC erfüllt oder begründet offen.
2. **Architektur** — Contracts-first, `AdapterContext`-Isolation, keine
   Imports aus `@ancientvoid/core`/`@ancientvoid/server` in Adaptern.
3. **Edge Cases** — Adapter-Crash mitten in Session, Blob-Grenzen, K5/K7/K8.
4. **Implementierungsqualität** — smallest correct, keine Spekulation.
5. **Determinism** — Tests ohne Fix rot denkbar; keine Flakes, keine
   Timing-Races (siehe `packages/core/test/sessionmanager.test.ts` als
   bekanntes Beispiel für ein knapp bemessenes Timing-Fenster).
6. **Future-Fragility (Pflicht)** — explizit zu:
   - Contract-Bruch in `@ancientvoid/contracts` ohne ADR
   - Adapter importiert `@ancientvoid/core`/`@ancientvoid/server` oder umgeht `AdapterContext`
   - Event-Payload > 4 KB ohne `ctx.blob()` (K5)
   - Neuer State ohne Recovery-Pfad / kein `adapter.recover()` (K7)
   - Stiller Drop unbekannter Provider-Events statt `system`-Event ("Fail loud")

## Output-Format

```text
Verdict: APPROVE | REQUEST CHANGES | COMMENT
D1 Requirements: 🟢|🔴 — <AC-Matrix>
D2 Architektur: 🟢|🟡|🔴
D3 Edges: …
D4 Qualität: …
D5 Determinism: … (Kommandos)
D6 Future-Fragility: <eine Aussage pro Punkt, „nicht betroffen" zählt>
Gates: 0/A/B/C/D/E je 🟢|🔴|n/a
Evidence: <Kommandos>
```

Danach nur auf Anweisung: `glab mr approve` bzw. `glab mr note --message`.

## Determinismus-Checkliste

- [ ] AC-Matrix vollständig (Dimension 1).
- [ ] Dimension 6 hat eine Zeile pro Punkt.
- [ ] Gates belegt, nicht behauptet.
- [ ] Kein Approve trotz fehlendem AC.

## Verweise

- [`bugfix`](../bugfix/SKILL.md) — typischer Vorgänger
- [`git-workflow`](../git-workflow/SKILL.md)
- [`ponytail-review`](../ponytail-review/SKILL.md)
