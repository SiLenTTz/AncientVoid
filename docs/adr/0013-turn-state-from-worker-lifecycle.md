# ADR-0013 — Zug-Status aus dem Worker-Lebenszyklus

**Status:** akzeptiert · **Betrifft:** `packages/core/src/sessionmanager.ts`
(`makeContext().spawnWorker`, `trackTurn`), T5.4, AC-P5-2
(`EPIC-P5-session-discovery-handoff-recovery.md`)

## Kontext

Kein Codepfad setzte `idle`. Eine Claude-, Codex-, OpenCode-, Copilot- oder
Aider-Session blieb nach einem fertigen Zug `working`. Die Oberfläche konnte
„läuft gerade“ und „wartet auf den nächsten Prompt“ nicht unterscheiden;
AC-P5-2 verlangt beide Zustände getrennt.

Alle CLI-Adapter starten **einen Prozess pro Zug** und nur über
`ctx.spawnWorker`, den der SessionManager bereitstellt.

## Entscheidung

1. Der SessionManager zählt die laufenden Worker einer Session
   (`activeWorkers`), direkt in `spawnWorker`.
2. Ein neuer Worker setzt eine `idle`-Session auf `working`.
3. Endet der letzte Worker mit Code 0 und startet binnen 250 ms kein neuer
   (Adapter wie codex prüfen vorher `--version`), wird die Session `idle`
   und der Verlauf bekommt `session.turn_end { code }`.
4. Ein Exit ≠ 0 ändert den Status hier nicht. Der Fehlerpfad bleibt beim
   Adapter (`process exited with code …`) und beim Heartbeat.
5. Kein neues Feld im Adapter-Vertrag. Adapter ohne Worker (dummy) bleiben,
   wie sie sind.

## Konsequenzen

- Jeder heutige und künftige CLI-Adapter bekommt den Zug-Status ohne eigene
  Arbeit, solange er über `spawnWorker` startet (Adapter-Regel ohnehin).
- `attachCmd` erscheint nur bei `working` mit lebendem Worker; zwischen
  Zügen gibt es keinen fälschlich aktiven Attach-Knopf (AC-P5-5).
- Ein Adapter, der künftig einen dauerhaft laufenden Prozess nutzt
  (interaktiver Modus), braucht ein eigenes Zugende-Signal. Dann wird diese
  ADR erweitert, nicht umgangen.

## Nachtrag 2026-09-24 — dauerhafte Agent-Prozesse (T7.2)

ACP-Harnesses (copilot `--acp`, opencode `acp`, dsh `--profile acp`)
bedienen viele Züge mit **einem** Prozess. Dafür, wie oben angekündigt:

- `SpawnOptions.persistent`: Ein solcher Worker zählt nicht als Zug
  (`trackTurn` übergeht ihn, auch bei `adoptWorker({ persistent: true })`).
- `ctx.turn("working" | "idle")`: Der Adapter meldet Zugbeginn und -ende;
  der SessionManager setzt `working`/`idle` und schreibt `session.turn_end`
  wie beim Prozessende.
- `SpawnOptions.stdin: "pipe"` / `WorkerSpec.stdin`: ein echter stdin-Strom.
  Der tmux-Runner liest ihn aus einer FIFO, die die Pane selbst lesend und
  schreibend offen hält (`exec 3<>fifo`); ein Hub-Neustart erzeugt kein EOF,
  der nächste Hub schreibt weiter (Test `tmux.test.ts` „pipe mode“, E2E
  „ACP-Agent übernommen nach SIGKILL“).
