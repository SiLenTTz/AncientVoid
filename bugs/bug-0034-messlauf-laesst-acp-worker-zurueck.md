---
id: BUG-0034
slug: messlauf-laesst-acp-worker-zurueck
status: done
severity: S2
area: messlauf, workers
instance: dev
commit: "2715b81"
forge: ""
epic: "P4.5"
created: 2026-09-27
reporter: jan
---

# BUG-0034 — Messlauf hinterlässt ACP-Worker und Zombie-tmux-Server

## Gesehen

Nach Messläufen am 24.09. liefen noch 16 `opencode acp`-Prozesse
(~250 MB RSS je) in Panes von 14 tmux-Servern weiter, deren Hub längst
weg war — niemand adoptiert sie je wieder (ADR-0014 greift nur bei
existierendem Hub mit gleichem dataDir).

## Erwartet

Ein Wegwerf-Hub (Messlauf/E2E) räumt seine Worker und seinen tmux-Server
komplett ab; verwaiste Worker sind mit einem Befehl auffind- und
entfernbar.

## Repro

1. `node scripts/messlauf-p7.mjs acp-gate opencode` (mit echtem
   `opencode acp`, das Tasks stellt).
2. Danach `ps aux | grep "opencode acp"` und
   `ls /tmp/uacc-p7-*/tmux-*/default`.

**Ergebnis nach Schritt 2:** Worker-Prozesse und tmux-Server des
Wegwerf-Roots bleiben bestehen. `stop()` in `bootHub()`
(scripts/messlauf-p7.mjs:71) SIGINTet nur den Hub-Kindprozess; der
Hub hält tmux-Worker beim Shutdown absichtlich am Leben
(`apps/hub/src/main.ts:251-255`, K7-Wiederanlauf), und niemand töten den
eigenen tmux-Server (E2E macht das richtig: `e2e/support/hub.ts:263`).

**Häufigkeit:** jeder Messlauf mit persistenten Workern

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | dev (Messlauf-Temp-Roots `/tmp/uacc-p7-*`) |
| Commit | `2715b81` |
| Adapter | acp (preset `opencode`) |
| Repro-Weg | Messlauf-Skript |

## Logs

Aufräumen am 26.09.: 48 Prozesse mit Logpfaden unter `/tmp/uacc-p7-*`
terminiert, 14 leere tmux-Server gekillt, 21 Temp-Roots entfernt;
~2,5 GB RSS frei. Die 3 Live-Worker des Produktions-Hubs blieben unberührt.

## Tests

| Ring | Befund / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `packages/workers/test/tmux.test.ts` | grün; Teardown/Orphan-Suche nicht abgedeckt |

Ohne Fix rot müsste: ein Test, der in einem Wegwerf-`TMUX_TMPDIR` einen
Worker erzeugt und nach `stop()` keinen tmux-Server mehr findet; plus
Unit-Tests der Orphan-Erkennung (`packages/workers/src/orphans.ts`).

## Eingrenzung

`scripts/messlauf-p7.mjs:71` — `stop()` ohne `tmux kill-server`, ohne
Warten auf Prozessende. Systemisch: tmux-Sessions tragen keine
`@uacc_logdir`-Marke (nur `@uacc_owner`, packages/workers/src/tmux.ts:243),
also kann kein Werkzeug Verwaiste sicher erkennen.

## Handoff

- [ ] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue angelegt (Link oben)
- [ ] `bugfix` oder offen lassen

## Fix (verifiziert 2026-10-03, Ralph mobile-hub-bugfrei)

- Fix: `e73dba4` (^ B workers: verwaiste Hub-Worker erkennen und entfernen
  (BUG-0034), MR !129) — `packages/workers/src/orphans.ts` (Erkennung über
  `@uacc_logdir`-Marke), hubctl-Command zum Aufräumen, messlauf-p7.mjs
  räumt tmux-Server beim stop() ab.
- Verifikation: `npx vitest run packages/workers/test/orphans.test.ts`
  → 6/6 grün (live nachgefahren 2026-10-03).
