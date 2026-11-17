# BUG-0179 — E2E-Stand-in-CLIs lassen sich auf Windows nicht spawnen

- **Status:** done
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

## Fix (2026-11-17, gemessen)

Ein Helfer, eine Regel: eine `.cmd`/`.bat`-Datei braucht auf Windows die Shell, echte CLIs
nicht. `packages/contracts/src/harness/spawn-shape.ts` liefert `shellFor(cmd)`; applied an
den Spawn-/execFile-Stellen, die konfigurierte Provider-Kommandos starten:

* `packages/workers/src/process.ts` (der zentrale `ctx.spawnWorker`-Pfad — alle CLI-Adapter)
* `packages/core/src/modules/harness/inventory.ts` (Anlage-Sonde)
* `packages/core/src/modules/discovery/claude-live.ts`, `modules/media/tools.ts`
* `packages/adapters/{cursor,opencode,acp}/src/index.ts` (Modell-Auflistung)

Dazu die Attrappen-Seite: `e2e/support/hub.ts` schreibt auf Windows einen `.cmd`-Wrapper
(`node "<Originalpfad>" %*`) nach `data/tmp-e2e/bin/` (git-ignored) und benutzt ihn — für
Adapter-`command`, `discovery.claudeCommand`, `forge.gitlab`, `media.ytDlp`,
`loops[].config.factory` und die ACP-Argv. Auf Unix bleibt jeder Pfad unverändert.

`contracts` ist auch im Browser unterwegs (die PWA importiert das Paket) und das Paket hat
keine Node-Typen — die Plattformprüfung läuft deshalb über `globalThis`, nicht über
`process.platform`.

Zusatzfund beim selben Gang: seit die Attrappen wirklich Kinderprozesse starten, hält eines
davon das Temp-Root des Test-Hubs im Moment der Räumung → `EPERM` in `TestHub.stop()`.
Begrenzt nachsehende Räumung (fünf Versuche, nur EPERM/EBUSY/ENOTEMPTY) statt Sofortaufgabe.

## Beleg (Windows, `--workers=1`)

* `e2e/specs/querformat.spec.ts` komplett: **6 grün** (die drei BUG-0053-Fälle mit der
  Claude-Attrappe waren wochenlang rot mit `read ECONNRESET`).
* `e2e/specs/nyx-fab.spec.ts`: **8 grün**, auch `BUG-0138 … liegt der FAB über dem Dock` —
  vorher der einzige rote Fall dieser Spec.
* `e2e/specs/harness.spec.ts -g "Kontextfenster folgt"`: **grün** (ACP-Attrappe, vorher
  ECONNRESET).
* typecheck und lint auf 0.

Damit ist die Aussage „Adapter-E2E sind lokal nicht prüfbar" von Windows aus Geschichte;
was bleibt, sind echte Assertions — genau das, was Tests leisten sollen.

## Nachtrag: dieselbe Wurzel in der Unit-Suite (2026-11-17, gemessen)

Neben den E2E-Specs holten sich auch Unit-/Integrationstests die Attrappe direkt — und
Windows konnte sie nicht starten. Sechs Dateien auf den gemeinsamen Helfer
`e2e/support/stand-in.ts` umgestellt:

* `apps/hub/test/factory.integration.test.ts`, `packages/adapters/{cursor,codex}/test/*`,
  `packages/adapters/acp/test/{adapter,catalog,contract}.test.ts`

Dazu die Spawn-Stellen, die konfigurierte Kommandos selbst starten und denen die Regel
fehlte: `packages/adapters/acp/src/catalog.ts`, `packages/adapters/codex/src/app-server.ts`,
`packages/core/src/modules/forge/gitlab-client.ts`,
`packages/core/src/modules/code/actions.ts`,
`packages/core/src/modules/workspace/workspace-services.ts` und
`packages/loops/securesight-factory/src/index.ts` — dort crashte `execFile(factoryBin, …)`
mit `spawn EFTYPE` (errno -4028) und brachte HTTP 500 in der Loop-Route; nach der Umstellung
ist kein EFTYPE mehr im Log (gemessen: dieselbe Testdatei einmal mit, einmal ohne diese
Stelle — 1x gegen 0x EFTYPE, identische Zaehlung). Die bleibende 422-Aussage ist
Windows-Pfad/Validierung und bleibt bei BUG-0170; vorher war sie vom Crash verdeckt.
Bewusst **nicht** angefasst:
`devices/device-service.ts` (adb/emulator sind `.exe`, da ist kein `.cmd`-Fall).

Messwert derselben sechs Dateien vor/nach dem Schritt: **5 failed | 78 passed → 1 failed |
82 passed.** Der eine Rest ist kein Spawn mehr, sondern eine echte Windows-Aussage:
`factory.integration` bricht mit „Projektpfad fehlt oder ist nicht absolut“ (422 statt 200) —
gehört in die BUG-0170-Familie (Windows-Pfade), nicht hierher. Das ist der eigentliche
Gewinn: was vorher Environment-Rauschen war, ist jetzt eine nachprüfbare Behauptung.

## Nachtrag 3 (2026-11-17): die Shell-Lösung war falsch — richtig ist Node vor dem Skriptpfad

Der `.cmd`-Wrapper aus dem ersten Fix legt `cmd.exe` zwischen Hub und Attrappe. Damit sind
Stdio-Pipes und Exit-Semantik kaputt. Gemessen: `packages/adapters/codex/test/app-server.test.ts`
brauchte **180,5 s** und ließ **13 von 16** Tests je 15 s auf JSON-RPC-Antworten warten
(`testTimeout` 15 s). Die Attrappen-Tests "grünten" nur scheinbar grün in der Zählung — sie
verpufften in Timeouts.

Neu: `classifyArgv`/`spawnArgv` in `packages/contracts/src/harness/spawn-shape.ts`. Auf
Windows bekommt ein **Skriptpfad** (Trenner drin, keine `.exe`/`.com`-Endung) das Node-Programm
vorangestellt: `node <skript> …`. Echte `.exe` bleiben unberührt, karge PATH-Namen (`git`) auch,
und `.cmd`/`.bat` — die CreateProcess gar nicht kann — bleiben der einzige Shell-Fall. Kein
Dateisystem-Check, weil `contracts` auch im Browser-Bundel lebt; die Unterscheidung läuft über
Trenner und Endung.

Umgestellt auf die neue Form: `workers/process.ts`, `core harness/inventory`,
`core discovery/claude-live`, `core media/tools`, `core forge/gitlab-client`,
`core code/actions`, `core workspace/workspace-services`, `adapters/cursor`,
`adapters/opencode`, `adapters/acp` (Index + catalog), `adapters/codex/app-server`.
Die Wrapper-Erzeugung in `e2e/support/stand-in.ts` ist raus — die Funktion liefert jetzt
überall den Originalpfad.

Beleg: dieselbe Codex-Datei plus zwei weitere (65 Tests) in **35,5 s**, **65 passed**,
vorher 180,5 s mit 13 Fehlern. Beweisbar zusätzlich durch die neue Unit-Datei
`packages/contracts/test/harness/spawn-shape.test.ts` (7 Fälle, läuft auf jeder Plattform,
weil Plattform/Node-Pfad Parameter sind).
