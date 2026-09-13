# Skills — portable Fähigkeiten

> Fähigkeiten liegen unter `.claude/skills/<name>/SKILL.md`. Claude Code
> liest diesen Ordner nativ. Verhaltensregeln stehen in
> [`AGENTS.md`](../../AGENTS.md) — Skills referenzieren sie, sie kopieren sie
> nicht. Übernommen und angepasst aus `custom-rag`
> (siehe [`docs/adr/`](../../docs/adr/) für den swarm-Adapter-Kontext).

## Progressive Disclosure

| Level | Was | Wo |
|---|---|---|
| 1 Discovery | `name` + `description` (YAML) | Frontmatter jeder `SKILL.md` |
| 2 Instructions | Zweck, Hard Rules, Phasen, Output | Body der `SKILL.md` (knapp halten) |
| 3 Resource | Geteilte Verträge | `_shared/` |

## Available Skills

| Skill | Kurzbeschreibung | Auto-loads when | Abgrenzung |
|---|---|---|---|
| [`gates`](gates/SKILL.md) | Qualitäts-Gates (npm test/lint/typecheck) in der richtigen Reihenfolge | „ist das grün?", CI rot, vor Commit | Messung, kein fachliches Urteil |
| [`git-workflow`](git-workflow/SKILL.md) | Conventional Commits, Branch, MR via glab | commit, branch, MR anlegen | ausführbare Form von `CONTRIBUTING.md` |
| [`bugfix`](bugfix/SKILL.md) | Reproduce → Fix → Re-verify → Finalize | Bug, Defekt, reproduzieren, Issue investigate | Handoff → `pr-review` |
| [`bug-report`](bug-report/SKILL.md) | Defekt sehen, belegen, unter `bugs/` anlegen | „Bug anlegen", Dev-Fund, Issue erstellen, kein Patch | kein Fix; Handoff → `bugfix` |
| [`pr-review`](pr-review/SKILL.md) | 6-Dimensionen-Gate-Review inkl. Future-Fragility | MR review, Merge-Freigabe, structured review | reines Lint bleibt `gates` |
| [`ponytail-review`](ponytail-review/SKILL.md) | Diff-Advisory, Tags `delete/stdlib/native/yagni/shrink` | Diff vereinfachen, Komplexität, YAGNI | read-only, keine Edits |
| [`architecture-best-practices`](architecture-best-practices/SKILL.md) | UACC-Pipeline, Modultiefe, Testing-Standard | Architektur, Schichten, Anti-Pattern | Referenz, kein Workflow |
| [`concept-phase`](concept-phase/SKILL.md) | Aufgabe in vertikale Slices (6 Dimensionen) | Aufgabe slicen, Scoping, Edges | `epic-creation` für neue Phasen |
| [`epic-creation`](epic-creation/SKILL.md) | Neue `EPIC-Pn`-Datei nach 7-Abschnitt-Schema | „neues Epic", „P5 planen" | Phasen-Ebene; Feinschnitt → `concept-phase` |
| [`messlauf`](messlauf/SKILL.md) | Messlauf gegen K1–K10 fahren und ablegen | Benchmark, Durchsatz, Latenz, Messzahl zitieren | Ablage unter `docs/messlauf/` |
| [`retro`](retro/SKILL.md) | Evidence-basierte Retro gegen Epic-AC | „Retro", Phasen-Abschluss | bewertet Vergangenheit; planen → `epic-creation` |

Vorlage für neue Skills: [`skill-template.md`](skill-template.md). UACC-Verträge,
die `ponytail-review` nicht wegoptimieren darf:
[`_shared/uacc-protected-invariants.md`](_shared/uacc-protected-invariants.md).

## Bewusst nicht übernommen

`product-wiki`, `browser-e2e`, `installer-hygiene`, `ui-schicht`,
`ponytail-audit`, `ponytail-debt`, `docs-hygiene` (als eigener Skill) — jeweils
weil die vorausgesetzte Infrastruktur (Playwright-Suite, Produkt-Wiki,
Installer-Wizard, Markdown-Lint-Tooling, Debt-Bestand) in diesem Repo noch
nicht existiert. Nachziehen, sobald der Bedarf real ist, nicht vorab
([`AGENTS.md`](../../AGENTS.md) Regel 5, "Kein Scope-Creep").

## Agenten

Rollen-Agenten unter `.claude/agents/`: [`hub-dev`](../agents/hub-dev.md)
(Hub-Kern + Adapter), [`pwa-dev`](../agents/pwa-dev.md) (PWA),
[`epic-planner`](../agents/epic-planner.md) (Phasen scaffolden).
