---
id: BUG-0019
slug: tmux-reap-kills-foreign-workers
status: done
severity: S1
area: workers
instance: dev
commit: ""
forge: ""
epic: "EPIC-P5 T5.6 / AC-P5-3, Premortem 3"
created: 2026-09-23
reporter: "Claude Opus 5.5 (Vorbereitung E2E-Gate)"
---

# BUG-0019 — Ein zweiter Hub oder `npm test` tötet die tmux-Worker des laufenden Hubs

## Gesehen

`TmuxRunner.reapOrphans(keep)` tötet jede tmux-Session mit Präfix `uacc-`,
die nicht in `keep` steht. Alle Hubs benutzen den Standard-tmux-Server des
Nutzers. Damit gilt:

- `packages/workers/test/tmux.test.ts` ruft im `afterAll`
  `reapOrphans([])` auf. Jedes `npm test` auf dem Entwicklungsrechner
  beendet alle laufenden Provider-Worker des echten Hubs.
- Jeder weitere Hub (E2E-Lauf, zweites Datenverzeichnis) räumt beim Start
  in `recoverAll()` die Worker des ersten weg.

## Erwartet

Ein Runner sieht und räumt nur Worker, deren Eigentum er belegen kann
(Premortem 3: „Adoption vor Reaping, Eigentumsnachweis“).

## Repro

1. Runner A (Log-Verzeichnis A) startet Worker `test-foreign`.
2. Runner B (Log-Verzeichnis B) ruft `reapOrphans([])` auf.

**Ergebnis:** `test-foreign` ist weg. `runner.list()` von B listet ihn.

**Häufigkeit:** immer, sobald tmux läuft.

Der rote Test lief auf einem isolierten tmux-Server (`TMUX_TMPDIR`), um
den Nutzer-Server nicht zu treffen.

## Eingrenzung

`packages/workers/src/tmux.ts`, `list()` filterte nur nach Präfix;
`reapOrphans()` baut darauf auf.

## Fix

`TmuxRunner` hat einen `owner` (Default: SHA-256 des aufgelösten
Log-Verzeichnisses, also pro `dataDir` stabil über Neustarts). `spawn()`
setzt die Session-Option `@uacc_owner`. `list()` und damit
`reapOrphans()`/`hasLiveWorker()` sehen nur eigene Worker.

Übergang: Worker, die ein älterer Hub ohne Markierung gestartet hat, gelten
als fremd. Sie werden weder adoptiert noch getötet. Nach einem Update
einmalig von Hand beenden (`tmux ls`, `tmux kill-session -t uacc-…`).

## Tests

| Ring | Datei | ohne Fix | mit Fix |
|---|---|---|---|
| Integration (tmux) | `packages/workers/test/tmux.test.ts` „BUG-0019“ | rot (fremder Worker gelistet) | grün |

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue
- [x] `bugfix`
