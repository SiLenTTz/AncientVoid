---
id: BUG-0157
slug: alter-worker-toetet-nachfolger
status: done
severity: S1
area: workers
instance: local
commit: "02fd546"
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/65"
epic: "P17/P27, PRD K7"
created: 2026-11-13
reporter: "Lifecycle-Review im Nutzerauftrag"
---

# BUG-0157 — Alter tmux-Handle beendet den Nachfolger derselben Session

## Gesehen

Ein Worker wird beendet, danach startet eine neue Generation unter demselben
Sessionnamen. Ein später Kill über den alten Handle beendet den neuen
Worker. Verzögertes Exit-Cleanup hat dieselbe Namensbindung. Wiederanläufe
können dadurch erneut abbrechen.

## Repro

Mit eigenen echten tmux-Test-Workern in
`packages/workers/test/tmux.test.ts`, Test „an old worker handle cannot
terminate a successor with the same session name“:

1. Worker starten, Kill und Exit abwarten.
2. Nachfolger mit gleichem Namen starten.
3. Über alten Handle noch einmal Kill senden.
4. Nachfolger muss weiterhin in der eigenen Worker-Liste stehen.

Vor Fix deterministisch rot: Nachfolger fehlt. Keine produktive Session
wurde für diesen Repro angefasst. Eine konkrete historische Unterbrechung
wird damit nicht nachträglich zweifelsfrei diesem Race zugeordnet.

## Ursache und Fix

`packages/workers/src/tmux.ts`, `track()`: Kill, Write und Cleanup zielen
auf den wiederverwendeten Sessionnamen. Log, Offset und FIFO werden beim
Nachfolger ebenfalls unter denselben Pfaden neu angelegt.

ADR-0074: unveränderliche Pane-ID als Ziel; eigene Log-/Offset-/FIFO-Dateien
je Generation, Recovery über `@ancientvoid_log`, Latest-Symlink für den
bisherigen Diagnosepfad. Legacy-Adoption bleibt erhalten.

## Verifikation

Alle 16 echten tmux-Tests grün, einschließlich Regression, Adoption,
umbenannter Worker und langer Pipe-Eingaben. Vollständiges Gate
(Test/Lint/Typecheck/E2E) grün im Abschluss-MR der Session-Robustheit;
Deployment im selben Zug nachgezogen.
