---
name: bugfix
description: Reproduce-Fix-Re-verify-Finalize-Playbook für Defekte im AncientVoid-Hub (contracts, core, workers, server, adapter, pwa). Aktiv, wenn ein Bug zu reproduzieren, ein Defekt zu fixen oder ein Issue zu investigate ist. Immer diesen Skill nutzen. Handoff an pr-review, nicht selbst mergen.
---

# Skill: bugfix

Querschnitts-Regeln: [`AGENTS.md`](../../../AGENTS.md). Branch/Commit/MR:
[`git-workflow`](../git-workflow/SKILL.md). Gates: [`gates`](../gates/SKILL.md).
AncientVoid-Verträge: [`.claude/skills/_shared/uacc-protected-invariants.md`](../_shared/uacc-protected-invariants.md).

## Zweck

Ein beobachteter Defekt wird root-caused, mit dem kleinsten korrekten Patch
behoben, gegen denselben Repro verifiziert und als MR übergeben. Eine
Änderung, die den Bug nie live beseitigt hat, ist keine Lösung.

## Wann benutzen (Trigger)

- „Bug fixen", „reproduzieren", „Defekt", „Issue investigate", Regression.
- Symptom in EventStore, SessionManager, Adapter, WS/Server, PWA.
- Eine Datei `bugs/bug-NNNN-*.md` existiert oder die Nummer ist genannt.

**Nicht benutzen für:** Features ohne Repro (`concept-phase` / `epic-creation`);
reines Anlegen ohne Patch (`bug-report`); reines Review (`pr-review`); reines
Aufräumen (`ponytail-review`).

Fehlt die Datei unter `bugs/`: zuerst [`bug-report`](../bug-report/SKILL.md).

## Hard Rules

- ✅ Reproduce **vor** Fix, Re-verify **nach** Fix.
- ✅ Root-cause: nenne `file:line`, das den Bug erzeugt — nicht das Symptom.
- ✅ Smallest correct fix. AncientVoid-Invarianten nicht umgehen.
- ✅ Bug-Fix-Test muss **ohne Fix scheitern**, mit Fix grün sein.
- ❌ Never self-merge, never force-push, never `--no-verify`.
- ❌ Kein Symptom-Patch (Retry-Schleife, `catch { }` leer), der die Ursache lässt.

## Phasen/Prozess

### 1. Reproduce

1. Quelle lesen: `bugs/bug-NNNN-slug.md` (SSOT), sonst den mündlichen Report.
   Fehlt die Datei → Skill `bug-report`. Acceptance und beobachtetes vs.
   erwartetes Verhalten festhalten.
2. Repro über die betroffene Testdatei (`packages/*/test/*.test.ts`), über
   `hubctl` (`node apps/hubctl/src/cli.ts sessions` /`tail`) oder über die
   PWA im Browser — je nachdem, wo das Symptom auftritt.
3. Repro **sehen**: Testfehlschlag, Log-Zeile, Event im Tail. Ohne
   Beobachtung kein Fix.

### 2. Fix

1. Ursache auf `file:line` eingrenzen. `AdapterContext`-Grenze, EventStore-
   Kappung (K5) und Recovery-Pfad (K7) nicht verdrehen.
2. Patch so klein wie korrekt. Contracts (`packages/contracts/src/*`) nicht
   „vereinfachen" ohne ADR.
3. Test zuerst (rot ohne Fix). Dann Produktionscode.

### 3. Re-verify

1. Denselben Repro erneut: Bug ist weg, Nachbarfälle nicht regressiv.
2. Umfang laut [`gates`](../gates/SKILL.md) (nur betroffene Spalten).
3. Test ohne den Produktionsfix noch einmal denken: würde er rot?

### 4. Finalize

1. Branch nur auf Anweisung: `fix/<slug>` (`git-workflow`).
2. Commit `^ B <bereich>: … (BUG-NNNN)` nach `docs/commit-notation.md` (`!` wenn nur live belegt).
3. MR: `glab mr create --description-file <datei>` mit Repro, Root-cause, Test, Gates.
4. **Handoff an [`pr-review`](../pr-review/SKILL.md).** Nicht selbst mergen.

## Nichtdeterminismus

Relevant wird das erst, sobald echte LLM-CLI-Adapter (`claude`, `codex`, P1)
oder der `swarm`-Adapter (P3) existieren — deren Antworten sind nicht
reproduzierbar, und ein einzelner grüner Durchgang gegen eine
Fixture-Aufnahme beweist dann wenig. Bis dahin ist dieses Repo deterministisch
(vitest, `EventStore`, `SessionManager`): ein Bug-Fix-Test, der einmal grün
läuft, gilt als belastbar.

## Output-Format

```text
Repro: <was beobachtet, Kommando/Test>
Root-cause: <file:line> — <warum>
Fix: <was geändert, warum smallest correct>
Verify: <Kommandos + Ergebnis>
Handoff: pr-review / MR-URL
```

## Determinismus-Checkliste

- [ ] Bug vor dem Patch live gesehen.
- [ ] Test ist ohne Fix rot, mit Fix grün.
- [ ] Gates der betroffenen Spalte grün.
- [ ] Kein Self-Merge, kein Force-Push.
- [ ] MR-Body nennt Repro und Root-cause.

## Verweise

- [`pr-review`](../pr-review/SKILL.md) — Handoff
- [`bug-report`](../bug-report/SKILL.md) — Datei anlegen, wenn sie fehlt
- [`architecture-best-practices`](../architecture-best-practices/SKILL.md)
