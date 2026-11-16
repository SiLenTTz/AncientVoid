# BUG-0179 — E2E-Stand-in-CLIs lassen sich auf Windows nicht spawnen

- **Status:** open
- **Schicht:** e2e (Test-Infra)
- **Schwere:** S2 — blockiert lokal jede Adapter-E2E-Prüfung; CI (Linux) ist grün

## Beobachtung

Auf Windows scheitern alle E2E-Specs, die eine Stand-in-CLI spawnen, mit
`Error: read ECONNRESET` in der Spec und im Hub-Log mit:

```
Error: spawn E:\Coding\AncientVoid\e2e\support\bin\claude ENOENT
    at ChildProcess._handle.onexit (node:internal/child_process:287:19)
```

Beobachtet in `e2e/specs/commands.spec.ts`, `e2e/specs/chat-zuege.spec.ts`
(opencode) und `e2e/specs/live-streaming.spec.ts` (claude) — jeweils identisch,
unabhängig vom Änderungenstand (mit `git stash` gegengeprüft).

## Ursache

Die Stand-ins in `e2e/support/bin/` sind Extensions-lose Node-Skripte mit
Shebang (`#!/usr/bin/env node`). Windows kann so eine Datei nicht als
Process starten; Node meldet `ENOENT` (nicht `EINVAL`), und der Hub-Worker
stirbt — das bringt die WebSocket-Verbindung der Spec zu Fall, deshalb das
irreführende `ECONNRESET` statt eines klaren Setup-Fehlers.

## Fix-Idee

In `e2e/support/hub.ts` die `command`-/`factory`-/`ytDlp`-Pfade über einen
Helfer laufen lassen, der auf `win32` `<name>.cmd`-Wrapper in das Temp-Root
schreibt (`node "<absoluter Pfad>" %*`) **und** der Worker-Runner den Spawn mit
`shell: true` (nur `win32`) ausführt — oder die Stand-ins als `.cmd` ausliefern.
Der Helfer muss auch `discovery.claudeCommand`, `forge.gitlab`, `media.ytDlp` und
`loops[].config.factory` erwischen, sonst bleiben Teile der Suite rot.

## Warum das wichtig ist

Solange das zu ist, gilt lokal: **Adapter-E2E sind auf diesem Rechner nicht
prüfbar** — die Adapter-Logik muss über Adapter-Tests mit Fake-Worker belegt
werden (Vorbild: `packages/adapters/claude/test/adapter.test.ts`). Bis dahin in
Specs, die Stand-ins spawnen, sichtbar `test.skip(process.platform === "win32", …)`
setzen — ein Skip zählt nicht als Bestehen.
