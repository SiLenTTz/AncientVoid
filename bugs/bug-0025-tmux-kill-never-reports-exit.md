---
id: BUG-0025
slug: tmux-kill-never-reports-exit
status: fixed
severity: S2
area: workers
instance: dev
commit: ""
forge: ""
epic: "EPIC-P5 T5.4/T5.6 (ADR-0013/0014)"
created: 2026-09-23
reporter: "Claude Opus 5.5 (Gate-Lauf neben dem echten Hub)"
---

# BUG-0025 — Ein per Kill beendeter tmux-Worker meldet nie sein Ende

## Gesehen

Neben dem laufenden echten Hub (eigene `uacc-*`-Session auf dem
Standard-tmux-Server) liefen zwei tmux-Tests in den Timeout: `exited()` eines
per `kill("SIGKILL")` beendeten Workers kam nie. Isoliert (eigener
tmux-Server, der mit der letzten Session endet) grün.

## Erwartet

`exited()` löst auf, sobald die tmux-Session weg ist, egal was sonst auf dem
Server läuft.

## Repro

```bash
tmux new-session -d -s uacc-probe-x "sleep 30"; tmux kill-session -t uacc-probe-x
tmux display-message -p -t uacc-probe-x '#{pane_dead}'; echo $?   # → leer, Exit 0
```

(tmux 3.7c, während eine andere Session auf dem Server läuft.)

**Folge im Betrieb:** Nach „Stop“ blieb der Worker-Zähler (ADR-0013) hängen;
nach „Weiter“ wurde die Session nie mehr `idle`.

## Eingrenzung

`packages/workers/src/tmux.ts`, `paneDead()`: leere Ausgabe mit Exit 0 galt
als „läuft noch“.

## Fix

Erst `has-session -t =<name>` (exakter Name), leere `pane_dead`-Ausgabe gilt
als beendet.

## Tests

| Ring | Datei | ohne Fix | mit Fix |
|---|---|---|---|
| Integration (tmux) | `packages/workers/test/tmux.test.ts` „BUG-0025“ (Zweit-Session hält den Server) | rot (hängt) | grün |

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue
- [x] `bugfix`
