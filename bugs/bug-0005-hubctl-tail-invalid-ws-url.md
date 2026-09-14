---
id: BUG-0005
slug: hubctl-tail-invalid-ws-url
status: done
severity: S1
area: hubctl
instance: dev
commit: ""
forge: "https://gitlab.com/SiLenT_Tz/mobile-hub/-/work_items/5"
epic: EPIC-P0
created: 2026-09-15
reporter: "Claude Sonnet 5 (Session 012Ga2NDi683xR9E63StoN7T)"
---

# BUG-0005 — `hubctl tail <id> -f` konnte nie eine WS-Verbindung aufbauen

## Gesehen

Beim Bau des AI-P0-3-Messlaufs (echter Hub-Server + echte `hubctl`-CLI als
Subprozess, siehe `scripts/messlauf-hubctl-latency.mjs`) schlug jeder Lauf
sofort fehl: `hubctl: TypeError: Invalid URL`.

## Erwartet

`hubctl tail <sessionId> -f` verbindet sich per WebSocket zum Hub und
streamt Events live (T0.11, README Quick-Start-Beispiel).

## Repro

1. Hub-Server lokal starten (`node packages/server/src/main.ts` o. ä.),
   Token ausstellen, Session anlegen.
2. `UACC_URL=http://127.0.0.1:<port> UACC_TOKEN=<token> node packages/hubctl/src/cli.ts tail <sessionId> -f`

**Ergebnis:** sofortiger Absturz mit `TypeError: Invalid URL`, keine
Verbindung, keine Events.

**Häufigkeit:** immer — kein Zufall, ein Konstruktionsfehler.

## Logs

```text
[hubctl stderr] hubctl: TypeError: Invalid URL
```

## Eingrenzung

`packages/hubctl/src/cli.ts` (vor dem Fix), `followWs()`:

```ts
const url = `${proto}:${BASE.replace(/^https?/, "")}/api/events/${sessionId}/tail...`;
```

Der Regex `/^https?/` entfernt nur `http`/`https`, **nicht** den
nachfolgenden Doppelpunkt. Für `BASE = "http://127.0.0.1:7373"` ergibt das
`ws:` + `://127.0.0.1:7373...` = `ws:://127.0.0.1:7373...` — eine
ungültige URL (doppelter Doppelpunkt). Der einzige bestehende Server-Test
(`server.test.ts`) baut seine WS-URL manuell und richtig, umgeht also genau
diesen Pfad — deshalb blieb der Fehler seit T0.11 unentdeckt.

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `packages/hubctl/test/cli.test.ts` (`buildWsUrl`) | nicht vorhanden — hubctl hatte gar keine Tests |

`followWs`s URL-Bau wurde in eine exportierte, reine Funktion
`buildWsUrl()` extrahiert und direkt getestet (http→ws, https→wss, Token
als Query-Param, kein Token → keine Query).

## Fix (Ergänzung)

Beim Schreiben des Regressionstests ein zweites, verwandtes Problem
gefunden: `cli.ts` rief `main().catch(...)` **unconditional auf Modulebene**
auf — ein `import { buildWsUrl } from "./cli.ts"` im Test führte die
komplette CLI aus (inkl. `process.exit(1)` über `usage()`, da kein
bekanntes Kommando in `process.argv`). Guard ergänzt: `main()` läuft nur,
wenn die Datei direkt ausgeführt wird (`import.meta.url` vs.
`pathToFileURL(process.argv[1])`), nicht beim Import als Modul.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitLab-Issue angelegt (Link oben)
- [x] `bugfix` — behoben: `/^https?:/` (inkl. Doppelpunkt), `buildWsUrl()`
      extrahiert und unit-getestet, `main()` hinter einen
      Direct-Execution-Guard gestellt.
