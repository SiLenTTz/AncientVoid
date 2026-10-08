---
id: BUG-0020
slug: diff-hides-new-files
status: done
severity: S2
area: server
instance: dev
commit: ""
forge: ""
epic: "EPIC-P2 T2.2/T2.3 (Diff), gefunden beim P5-E2E-Gate"
created: 2026-09-23
reporter: "Claude Opus 5.5 (E2E-Gate, session.spec.ts)"
---

# BUG-0020 — Diff und Bericht zeigen keine neu angelegten Dateien

## Gesehen

Ein Agent legt in seiner Session `e2e-change.txt` an. Der Diff-Tab zeigt
„keine Änderungen im Arbeitsverzeichnis“, der Bericht „Dateien geändert:
keine Änderungen im Arbeitsverzeichnis“.

## Erwartet

Neue, nicht ignorierte Dateien erscheinen mit `+N` im Diff und zählen im
Bericht. `.gitignore`-Treffer bleiben draußen.

## Repro

E2E: `e2e/specs/session.spec.ts` „der Diff zeigt die geänderte Datei“
(fake `opencode` mit Stichwort `DATEI`). Unit: Datei im Repo anlegen, nicht
stagen, `getSessionDiff(dir)`.

**Häufigkeit:** immer. Betrifft jede Datei, die ein Agent neu erzeugt.

## Eingrenzung

`packages/server/src/diff.ts`, `realGitDiff()`: nur `git diff <base>`,
das untracked Dateien nie enthält.

## Fix

`untrackedDiff()` listet `git ls-files --others --exclude-standard` und
hängt je Datei `git diff --no-index /dev/null <file>` in derselben
numstat-/Patch-Form an (feste `a/` `b/`-Präfixe, unabhängig von
`diff.mnemonicPrefix`). Obergrenze 200 Dateien.

Bekannte Grenze: ohne Worktree-Isolation (Fallback im Projektordner)
zählen auch untracked Dateien, die schon vor der Session da waren — wie
bisher schon bei getrackten Änderungen.

## Tests

| Ring | Datei | ohne Fix | mit Fix |
|---|---|---|---|
| Unit (echtes git) | `packages/server/test/diff.test.ts` „BUG-0020“ | rot | grün |
| E2E | `e2e/specs/session.spec.ts` Diff und Bericht | rot | grün |

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue
- [x] `bugfix`
