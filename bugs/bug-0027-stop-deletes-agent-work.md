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

## Vorfall beim Einspielen (2026-09-23, 14:17)

Der Fix wurde gemerged, der Hub danach mit `scripts/hub.sh stop` neu
gestartet. SIGTERM löst `sessions.shutdown()` aus, das jede nicht gestoppte
Session stoppt — ausgeführt vom **alten** Prozess, also noch mit dem Bug. Der
Worktree von Session 821b0ec8 (tetris-reloaded, `index.html` 27 552 B,
`README.md` geändert, nichts committet) wurde gelöscht.

**Wiederhergestellt** aus OpenCodes eigenem Snapshot-Repo
(`~/.local/share/opencode/snapshot/3f1fe4d…/cde1247…`, Tree `843cde6`, letzter
Stand des Laufs): Worktree und Branch `uacc/821b0ec8…` am alten Ort neu
angelegt, Dateien byte-identisch zurückgeschrieben (SHA-1 geprüft), README
zusätzlich gegen das letzte `write`-Event (seq 97) im Hub-Verlauf verglichen.
Git-Status wie vorher: ` M README.md`, `?? index.html`.

**Lehre:** Ein Fix gegen Datenverlust im Stop-Pfad darf nicht per sauberem
Herunterfahren eingespielt werden, solange der alte Prozess läuft. Dafür
`kill -9 $(cat /tmp/uacc-hub.pid)` und dann `scripts/hub.sh start` — der Hub
übernimmt laufende tmux-Züge (ADR-0014), ohne Stop-Pfad.
