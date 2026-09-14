---
name: git-workflow
description: Conventional Commits, Branch-Naming feat/fix/docs, GitLab-MR via glab, Co-Author-Trailer. Aktiv bei commit, branch, PR/MR anlegen. AI legt keine Branches ohne Anweisung an. Never force-push, never commit auf main.
---

# Skill: git-workflow

Querschnitts-Regeln: [`CONTRIBUTING.md`](../../../CONTRIBUTING.md). Gates:
[`gates`](../gates/SKILL.md). Review: [`pr-review`](../pr-review/SKILL.md).

## Zweck

Commit, Branch und MR sehen jedes Mal gleich aus. Dieser Skill ist die
ausführbare Form; `CONTRIBUTING.md` bleibt die Regelquelle.

## Wann benutzen (Trigger)

- commit, branch anlegen, MR öffnen, Conventional Commit, Co-Author.

**Nicht:** Epic-Struktur (`epic-creation`); Bugfix-Ablauf (`bugfix`).

## Hard Rules

- ✅ Conventional Commits: `feat|fix|docs|refactor|perf|test|chore|ci`.
- ✅ Branch: `feat/<scope>-<slug>` · `fix/<problem>` · `docs/<scope>`.
- ✅ Co-Author-Trailer bei KI-Commits.
- ✅ AI **never** creates branches without developer instruction.
- ❌ Never force-push, never rewrite published history, never commit auf `main`.
- ❌ Never `--no-verify`.

## Kadenz — wann commit, wann push, wann MR (deterministisch)

Diese Momente sind fest, keine Ermessenssache:

| Ereignis | Aktion |
|---|---|
| Task/Aufgabe (`T<n>.<m>`) einer Epic abgeschlossen | commit (lokal, auf dem laufenden `feat/`-Branch) |
| Bugfix abgeschlossen (`bugfix`-Skill, Finalize) | commit **+ push + MR** (`glab mr create`) |
| Epic abgeschlossen (alle AC grün, `retro` gelaufen) | commit **+ push + MR** für den Epic-/Feature-Branch nach `main` |

Solo-Projekt, kein zweiter Reviewer: Self-Merge der eigenen MR ist zulässig.
Der "Nicht self-merge"-Grundsatz aus [`pr-review`](../pr-review/SKILL.md)
gilt der fachlichen Prüfung (MR-Beschreibung nennt Repro/Root-cause/
Testplan, Gates sind grün) — nicht einem erzwungenen zweiten Menschen. Die
MR bleibt trotzdem Pflicht: sie ist der Log-Eintrag der Historie, nicht die
Freigabe.

**Ausnahme:** Die ersten Commits (Kaltstart, initiale Tooling-Übernahme aus
custom-rag) gingen einmalig direkt auf `main`, bevor diese Kadenz-Regel
existierte. Ab hier gilt sie ausnahmslos — auch für kleine Fixes.

## Phasen/Prozess

### 1. Branch (nur auf Anweisung)

```bash
git checkout -b feat/adapter-local-llm
```

Kein Push direkt auf `main`.

### 2. Pre-Commit Checks

Dieselben Gates wie [`gates`](../gates/SKILL.md): `npm test && npm run lint
&& npm run typecheck`. Es gibt kein lokales Git-Hook-System in diesem
Repo (kein `pre-commit`) — die drei Kommandos oben sind die einzige Prüfung
vor dem Commit, die CI (`.gitlab-ci.yml`) wiederholt sie danach.

### 3. Commit

```text
feat(adapter-local-llm): stream parsing for llama.cpp server

fix(eventstore): survive hard restart without losing tail events

docs(adr): swarm adapter context and steer/approval gap

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
```

Subject ≤ ~72 Zeichen, Imperativ, Scope = Package/Bereich. Keine Secrets.

### 4. MR (GitLab)

```bash
glab mr create --title "feat(adapter-local-llm): stream parsing" --description-file mr-desc.md
```

Body: Warum, Testplan, Link Issue. Self-Merge zulässig (Solo-Projekt, siehe
Kadenz oben) — die MR bleibt trotzdem Pflicht als Log-Eintrag.

### 5. Post-Merge Cleanup (Pflicht nach jedem Merge)

```bash
# Lokal
git checkout main
git pull
git branch -d feat/mein-feature

# Remote
git push origin --delete feat/mein-feature
```

## Output-Format

```text
Branch: <name oder „nicht angelegt, keine Anweisung">
Commit: <subject>
MR: <url oder Entwurf>
Checks: npm test / lint / typecheck <ok|pending>
```

## Determinismus-Checkliste

- [ ] Branch-Schema `feat/*` · `fix/*` · `docs/*`.
- [ ] Kein Branch ohne Anweisung.
- [ ] Pre-Commit-Bezug konkret (`npm test/lint/typecheck`, nicht „irgendwelche Checks").

## Verweise

- [`CONTRIBUTING.md`](../../../CONTRIBUTING.md)
- [`gates`](../gates/SKILL.md)
- [`bugfix`](../bugfix/SKILL.md)
