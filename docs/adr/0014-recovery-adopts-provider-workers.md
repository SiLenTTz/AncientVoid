# ADR-0014 — Recovery übernimmt Provider-Worker

**Status:** akzeptiert · **Betrifft:** `packages/contracts/src/adapter.ts`
(`AdapterContext.adoptWorker`, `AdapterContext.nativeSessionId`),
`packages/contracts/src/worker.ts` (`WorkerRunner.adopt`),
`packages/workers/src/tmux.ts`, `packages/core/src/sessionmanager.ts`,
`packages/adapter-{claude,codex,opencode,copilot}`, T5.6, AC-P5-3

## Kontext

Nur der Dummy-Adapter hatte `recover()`. Nach einem harten Hub-Kill waren
Claude-, Codex-, OpenCode- und Copilot-Sessions `observed` und nicht mehr
steuerbar; ihr tmux-Worker wurde beim Start als Waise getötet — auch mitten
im Zug. Der tmux-Worker überlebt den Hub aber (ADR-P0-3), und jede dieser
CLIs kann per nativer Session-ID fortsetzen.

## Entscheidung

1. **Runner.** `WorkerRunner.adopt?(name)` nimmt einen eigenen, noch
   vorhandenen Worker wieder auf (`@uacc_owner`, BUG-0019). Der TmuxRunner
   schreibt beim Ausliefern vollständiger Zeilen die Byte-Position nach
   `<log>.offset`; `adopt()` liest ab dort weiter. Der ProcessRunner hat
   kein `adopt` — seine Worker enden mit dem Hub.
2. **Kontext.** `AdapterContext` bekommt, beide optional:
   `adoptWorker()` (liefert den übernommenen Worker oder `null`, zählt ihn
   für den Zug-Status mit, ADR-0013) und `nativeSessionId` (die zuletzt im
   Hub gespeicherte Provider-ID). Der Hub speichert jede
   `payload.nativeSessionId` aus Events; Codex und Copilot melden ihre ID
   dafür jetzt als Event.
3. **Adapter.** `recover()` in claude, codex, opencode und copilot:
   Worker übernommen → Ausgabe läuft weiter, Handle zurück. Kein Worker,
   aber Provider-ID → Handle zurück, der nächste Prompt setzt nativ fort.
   Weder noch → `null` (ehrlich nicht steuerbar, ADR-0011 Punkt 5).
4. **Status.** Ein Handle ohne übernommenen Worker heißt „zwischen Zügen“:
   `working` wird `idle`. Sessions mit Handle stehen in `keepWorkers` und
   werden nicht geräumt.

## Konsequenzen

- AC-P5-3 gilt für jeden CLI-Adapter mit nativer Fortsetzung: bestätigte
  Events exakt, laufender Zug läuft sichtbar zu Ende, danach dieselbe
  Provider-Session (E2E `recovery.spec.ts`, Messlauf `recovery-provider`).
- Grenze: Zeilen, die ausgeliefert, aber bis zum Kill noch nicht in den
  EventStore geschrieben waren (Flush alle 100 ms), fehlen. Bestätigte
  Events sind davon nicht betroffen.
- Mit ProcessRunner läuft ein Zug beim Kill als verwaister Prozess weiter,
  ohne dass der Hub ihn sieht. Nur tmux (Standard) übernimmt Züge.
- aider hat keine native Session-ID und bleibt ohne `recover()`.
- Claude: ein per `--agent` gewählter Agent wird nach dem Neustart nicht
  erneut übergeben; die Skill-Kette des Hubs (T5.10) schon.

## Nachtrag 2026-09-23 — geplanter Neustart

Ein SIGTERM/SIGINT (`scripts/hub.sh stop`) stoppt mit tmux-Runner keine
Session mehr: `shutdown({ keepWorkers: true })` schreibt nur den EventStore
weg. Status und laufende Züge bleiben, der nächste Start übernimmt sie wie
nach einem Absturz. Mit ProcessRunner enden die Worker mit dem Hub; dort
werden Sessions weiter gestoppt, ihre Worktrees mit Arbeit bleiben
(BUG-0027).
