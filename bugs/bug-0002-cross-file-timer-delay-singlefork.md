---
id: BUG-0002
slug: cross-file-timer-delay-singlefork
status: open
severity: S3
area: core
instance: dev
commit: "e25901f"
forge: "https://gitlab.com/SiLenT_Tz/mobile-hub/-/work_items/2"
epic: EPIC-P0
created: 2026-09-14
reporter: "Claude Sonnet 5 (Session 012Ga2NDi683xR9E63StoN7T)"
---

# BUG-0002 — Zeitbasierte `sessionmanager`-Tests werden verzögert, wenn andere Testdateien vorher liefen

## Gesehen

Läuft `packages/core/test/sessionmanager.test.ts` **nach** einer anderen
Testdatei im selben Prozess (`vitest.config.ts` hat
`poolOptions.forks.singleFork: true` — alle Dateien teilen sich einen
Node-Prozess), verzögert sich die Event-Generierung des Dummy-Adapters in
manchen Läufen so stark, dass ein `waitFor`-Poll mit 12 s Deckel abläuft,
bevor die erwarteten Events überhaupt erscheinen. Isoliert
(`npx vitest run packages/core/test/sessionmanager.test.ts`) lief dieselbe
Datei 5/5 Mal sauber in 1,5–2,5 s.

## Erwartet

Der Dummy-Adapter erzeugt Events nach seinem konfigurierten
`eventsPerSecond`-Takt unabhängig davon, welche Testdatei vorher im selben
Prozess lief — kein Cross-File-Zustand sollte die Timer-Latenz um
Größenordnungen verändern.

## Repro

Voraussetzung: keine (reiner Unit-Test).

1. `npx vitest run packages/workers/test/tmux.test.ts packages/core/test/sessionmanager.test.ts` mehrfach wiederholen — **oder**
2. `npx vitest run packages/server/test/server.test.ts packages/core/test/sessionmanager.test.ts` mehrfach wiederholen.

**Ergebnis:** ca. 1 von 3 Läufen schlägt in `sessionmanager.test.ts` fehl —
mal beim ersten Test ("creates a session…"), mal beim K7-Test —, mit einer
Laufzeit nahe am `waitFor`-Deckel (12–16 s statt der nominalen ~0,25–0,5 s).
Die anderen 2 von 3 Läufen sind sauber und schnell (~2–4,5 s Gesamtdauer).
Das Muster ist eher bimodal (schnell+sauber ODER nahe am Timeout) als
gleichmäßig verteilt — spricht eher für eine blockierte Warteschlange/
hängende Ressource als für allgemeine Systemlast.

**Nicht** reproduziert: `sessionmanager.test.ts` allein (5/5 sauber),
`server.test.ts` + `sessionmanager.test.ts` in 2 von 3 Versuchen sauber.

**Häufigkeit:** manchmal (~1/3 in Kombination mit einer vorlaufenden Datei).

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (reiner vitest-Lauf, kein Hub-Prozess) |
| Commit | `e25901f` |
| Node-Version | 26.7.0 |
| `ulimit -n` | 524288 (kein Verdächtiger) |
| Pool | `forks`, `singleFork: true` (`vitest.config.ts`) |
| Repro-Weg | `npx vitest run <datei1> <datei2>` — kein PWA/hubctl-Pfad, reiner Testcode |

## Logs

Vitest-Zusammenfassung als Evidenz (kein Hub-Log, siehe oben):

```text
FAIL packages/core/test/sessionmanager.test.ts > SessionManager > creates a session, persists it and emits lifecycle events
Error: waitFor: condition not met within 12000ms
   Duration  16.10s (… tests 15.82s …)
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `packages/core/test/sessionmanager.test.ts` (alle zeitbasierten Fälle) | betroffen, aber kein Fix in diesem Lauf |
| Contract (`adapter-testkit`) | — | nicht geprüft |

Kein Test schreibt dieser Skill — das ist `bugfix`. Kandidat für einen
Regressionstest: ein kombinierter Lauf zweier Dateien in CI, der die
Gesamtdauer gegen eine Obergrenze prüft (grobe Heuristik, kein Ersatz für
die eigentliche Root-Cause-Behebung).

## Eingrenzung

Nicht spezifisch für `TmuxRunner` (`packages/workers/src/tmux.ts`) — auch
`packages/server/test/server.test.ts` (Fastify-HTTP/WS-Server) reproduziert
es. Gemeinsamer Nenner bisher **nicht** gefunden: FD-Limit ist kein
Verdächtiger, `singleFork: true` bedeutet, dass alle Dateien denselben
Node-Event-Loop teilen — Verdacht liegt auf nicht vollständig geschlossenen
Ressourcen (Server-Handles, WS-Verbindungen, `fs.watch`-Instanzen,
`setInterval`ohne `unref()`) aus einer vorlaufenden Datei, die den
Event-Loop oder eine gemeinsame Warteschlange blockieren — **nicht
verifiziert**, nur Verdacht. Braucht gezielte Instrumentierung (z. B.
`--reporter=verbose` mit Zeitstempeln pro Hook, oder Node
`--prof`/`async_hooks`), um die tatsächliche blockierende Ressource zu
finden.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue angelegt (Link oben)
- [ ] `bugfix` — **offen gelassen**, kein Fix in diesem Lauf (Root-Cause
      unklar, Scope über den ursprünglich gemeldeten Test hinaus). Empfehlung:
      eigener Bugfix-Zyklus mit `async_hooks`-Instrumentierung, bevor P1
      beginnt — betrifft die Verlässlichkeit von `npm test` als Gate.
