---
id: BUG-0076
slug: pi-fehlerstatus-nach-erfolgreichem-turn
status: done
severity: S1
area: adapters
instance: dev
commit: ""
forge: "https://gitlab.com/SiLenT_Tz/mobile-hub/-/merge_requests/245"
work-item: "https://gitlab.com/SiLenT_Tz/mobile-hub/-/work_items/30"
epic: ""
created: 2026-10-28
reporter: "Maki (Session e2e84c77)"
---

# BUG-0076 — pi: fehlerfreier Folgelauf bleibt auf `status: error` (stale `healthy=false`)

## Gesehen

Eine pi-Session, deren erster Turn abnorm endet (Exit-Code ≠ 0, z. B.
Quota/Provider-Fehler), wird vom Heartbeat zu Recht auf `error` gesetzt.
Der nächste Prompt startet einen **neuen** Prozess (pi ist one-shot pro
Turn wie `claude -p`), dieser läuft fehlerfrei und beendet sich mit
Exit-Code 0 — der nächste Heartbeat-Tick markiert die Session trotzdem
wieder `error` (`adapter.down`), obwohl der letzte Turn erfolgreich war.
Das wiederholt sich für jeden weiteren erfolgreichen Turn.

## Erwartet

`adapter.status()` meldet den Zustand des **aktuellen** Prozesses. Ein
fehlerfreier Turn nach einem früheren Fehlschlag ist `healthy` — der
Heartbeat (`runHeartbeat`, SessionManager) darf die Session nicht als
`error` anzeigen. Genau das leistet der Reset `meta.healthy = true` in
`attach()`, den alle übrigen One-Shot-Adapter seit BUG-0008 haben.

## Repro

Adapter-Ebene (deterministisch, Test in
`packages/adapters/pi/test/adapter.test.ts`):

1. `createAdapter()` mit überschriebenem `spawnWorker`, dessen Prozess
   mit Code 3 endet → `status()` → `down` (echter Fehler, korrekt).
2. `steer({kind:"prompt"})` → neuer Prozess, endet mit Code 0.
3. `status()` → **erwartet `healthy`**, beobachtet `down`.

Über den Hub dasselbe Bild: Heartbeat setzt `status:"error"` +
`adapter.down`-Event, PWA zeigt „Fehler", PWA-Statusleiste zählt die
Session als Fehler — trotz erfolgreich abgeschlossenen Laufs.

**Häufigkeit:** deterministisch — jede pi-Session nach dem ersten
abnormen Turn-Exit.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal |
| Commit | `97ca897` |
| Node-Version | ≥ 22.5 |
| Adapter | pi |
| Repro-Weg | Unit/Adapter-Test (testkit `makeRecordingContext`) |

## Logs

(Synthetischer Repro, keine Live-Logs — Verhalten folgt direkt aus dem
Code: `attach()` setzt `meta.healthy` nicht zurück.)

```text
turn 1: exit 3  → meta.healthy = false → heartbeat: error   (korrekt)
turn 2: exit 0  → meta.healthy bleibt false → heartbeat: error   (FALSCH)
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `packages/adapters/pi/test/adapter.test.ts` | nicht vorhanden |

Fix: `packages/adapters/pi/src/index.ts` `attach()` — pro-Prozess-Reset
`meta.healthy = true` (BUG-0008-Nacharbeit, wie adapter-claude/-codex/-aider/
-copilot/-opencode/-hermes). Test rot ohne Fix (`expected 'down' to be
'healthy'`), grün danach; `npm test` (1072), `lint`, `typecheck`,
`test:e2e` (241 passed, 2 sichtbar skipped) grün.

## Eingrenzung

`packages/adapters/pi/src/index.ts:92` — `attach()` fehlt der
pro-Prozess-Reset `meta.healthy = true`, den
adapter-claude (`index.ts:178`), adapter-codex (`index.ts:115`),
adapter-aider (`index.ts:94`), adapter-copilot (`index.ts:80`),
adapter-opencode (`index.ts:108`) und adapter-hermes (`index.ts:122`)
als BUG-0008-Nacharbeit haben. Gleiche Klasse wie BUG-0008, nur die
Nachwirkung (stale-forever statt sofort-falsch).

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitLab-Issue angelegt (Link oben)
- [x] `bugfix` gelaufen (Fix in !245, Gates grün)
