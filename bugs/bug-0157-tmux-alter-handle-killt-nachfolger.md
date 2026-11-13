---
id: BUG-0157
slug: tmux-alter-handle-killt-nachfolger
status: fixed
severity: S2
area: workers
instance: local
commit: "17d7c87"
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/65"
epic: "Session-Robustheit (Issue #65), ADR-0075"
created: 2026-11-13
reporter: "Lifecycle-Review im Nutzerauftrag (GitLab #65, Datei hier materialisiert)"
---

# BUG-0157 — Alter tmux-Handle beendet den Nachfolger derselben Session

## Gesehen

Ein Worker wird beendet, danach startet eine neue Generation unter demselben
Sessionnamen. Ein späterer Kill über den alten Handle beendet den neuen
Worker. Verzögertes Exit-Cleanup hat dieselbe Namensbindung (Issue #65).

## Erwartet

Ein alter Handle trifft nur noch seine eigene Generation.

## Repro

`packages/workers/test/tmux.test.ts`, Test „an old worker handle cannot
terminate a successor with the same session name": Worker starten, Kill und
Exit abwarten, Nachfolger mit gleichem Namen starten, über den alten Handle
erneut Kill senden — der Nachfolger muss weiterlaufen und in der
Worker-Liste stehen. **Vor dem Fix deterministisch rot** (belegt 13.11.2026
per Stash-Wiederholung), danach grün.

## Root-cause

`packages/workers/src/tmux.ts` `track()`: Kill (SIGTERM/SIGKILL), Write
(send-keys), Statusabfragen (pane_dead/pane_pid) und das Exit-Cleanup
(kill-session) adressierten den **wiederverwendbaren Sessionnamen**;
Log/Offset/FIFO lagen ebenfalls namensbasiert.

## Fix ([ADR-0075](../docs/adr/0075-tmux-generationssteuerung.md))

- Steuerung über die unveränderliche **Pane-ID** der eigenen Generation;
  totes Ziel = eigene Pane weg (auch unter laufendem Nachfolger).
- kill-session nur bei nachgewiesener Pane-Zugehörigkeit (Nachfolger bleibt
  unbehelligt).
- Log/Offset/FIFO **je Generation** (`<name>.<workerId-8>.…`), `<name>.log`
  als Latest-Symlink für Diagnosepfad und Legacy-Adoption.
- Neuer Marker `@ancientvoid_log` (auch in `list()`), `adopt()` bevorzugt
  ihn; Legacy-Fallbacks (Name, Umbenennungs-Heuristik) bleiben.
- Contract additiv: `WorkerInfo.log?: string`.

## Tests

| Ring | Datei | Stand |
|---|---|---|
| Unit (echtes tmux) | `packages/workers/test/tmux.test.ts` | 16/16 grün (inkl. Adoption, umbenannte Worker, lange Pipe-Eingaben); neuer Test rot-vor-Fix belegt |

## Handoff

- [x] Fix + ADR-0075 + Tests (MR folgt)
- [x] Datei im Index [`README.md`](README.md)
- [x] GitLab-Issue [#65](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/65)
- [ ] Vollgate/E2E im gemeinsamen Abschluss (läuft parallel)
