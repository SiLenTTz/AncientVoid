---
id: BUG-0027
slug: stop-deletes-agent-work
status: fixed
severity: S1
area: core
instance: dev
commit: ""
forge: ""
epic: "EPIC-P2 T2.1 (Worktree-Isolation), gefunden im P5-Handtest"
created: 2026-09-23
reporter: "Claude Opus 5.5 (Analyse zur Nutzerfrage „Änderungen nicht im Repo“)"
---

# BUG-0027 — Stop löscht die nicht committete Arbeit eines Agenten

## Gesehen

`SessionManager.stop()` rief für jede isolierte Session
`WorktreeManager.remove()` auf: `git worktree remove --force` und
`git branch -D uacc/<id>`. Nicht committete Dateien (im echten Lauf
`index.html`, 27 KB Tetris) und Commits auf dem Session-Branch wären
unwiederbringlich weg. „Weiter“ legte danach einen frischen Worktree ab dem
Projektstand an — der Agent hätte ohne seine Arbeit weitergemacht.

## Erwartet

Stop verliert keine Arbeit. Ein Worktree mit Änderungen oder eigenen Commits
bleibt samt Branch; „Weiter“ läuft darin weiter. Nur saubere Worktrees
werden aufgeräumt (Plattenplatz, T2.1).

## Repro

`packages/core/test/sessionmanager.test.ts` „BUG-0027“: Datei im Worktree
anlegen, `stop()` → ohne Fix ist sie weg.

**Häufigkeit:** immer bei Stop einer isolierten Session mit Arbeit.

## Eingrenzung

`packages/core/src/sessionmanager.ts` `stop()` (T2.1-Cleanup),
`packages/core/src/worktree.ts` `remove()`.

## Fix

`WorktreeManager.hasWork()` (`status --porcelain` oder Commits seit
`worktreeSha`). Mit Arbeit: `session.worktree_kept { path, branch }` statt
Entfernen.

## Tests

| Ring | Datei | ohne Fix | mit Fix |
|---|---|---|---|
| Integration (echtes git) | `sessionmanager.test.ts` „BUG-0027“ (uncommitted, Commit, sauber) | rot | grün |

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue
- [x] `bugfix`
