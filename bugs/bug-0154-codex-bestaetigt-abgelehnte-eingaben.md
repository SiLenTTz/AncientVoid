---
id: BUG-0154
slug: codex-bestaetigt-abgelehnte-eingaben
status: open
severity: S2
area: adapter-codex
instance: dev
commit: "f92263a"
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/61"
epic: "P17/P27, PRD K2/K7"
created: 2026-11-13
reporter: "Session-Audit im Nutzerauftrag"
---

# BUG-0154 — Codex bestätigt abgelehnte Folgeeingaben als angenommen

## Gesehen

Bei einer RPC-Ablehnung von `turn/steer` liefert der Adapter `{ ok: true }`
ohne Fehlerereignis. Bei Ablehnung von `turn/start` meldet er zwar
`provider.error`, liefert dem Steer-Aufrufer aber ebenfalls Erfolg.

## Erwartet

Nachweislich abgelehnte Eingaben erhalten ein negatives Ack samt sichtbarem
Grund. Die Idempotenz-ID darf nicht als erfolgreich angenommen verbucht
werden. Ein Transport-Timeout bleibt ein unbekanntes Ergebnis; keine blinden Retries.

## Repro

**Adapter-Naht bestätigt; PWA/hubctl-Repro nicht durchgeführt.** Node 26.7.0,
Codex app-server-Modus, keine Cloud-Anfrage. In-memory `WorkerProcess` über
`makeRecordingContext({ spawnWorker, turn })` und echten `JsonRpcConnection`:

1. `initialize` und `account/rateLimits/read` mit leerem Result beantworten.
2. `thread/start` mit `thread.id = "thread"` beantworten.
3. `start({ prompt: "first" })`: `turn/start` mit `turn.id = "turn"` beantworten.
4. `steer(handle, { kind: "prompt", text: "followup" })`: `turn/steer`
   mit RPC-Fehler `-32000`, Meldung „provider rejected input“ beantworten.
5. `turn/completed` für diesen Thread/Zug simulieren.
6. Neues `steer(prompt)` ausführen und diesmal `turn/start` gleichartig ablehnen.

```text
Rejected turn/steer -> {"ok":true} provider.error count: 0
Rejected turn/start -> {"ok":true} provider.error count: 1
```

**Häufigkeit:** deterministisch für beide Ablehnungen. Historische Zuordnung
zu einer konkreten verlorenen Nachricht nicht nachgewiesen.

## Eingrenzung

- `packages/adapters/codex/src/app-server.ts:233`: `steer(prompt)` fängt die
  `turn/steer`-Ablehnung leer ab; `startTurn()` propagiert in Zeile 180–183
  die Ablehnung nicht, der Aufrufer liefert in Zeile 237 trotzdem Erfolg.
- `packages/core/src/modules/sessions/session-manager.ts`: `steerNow()`
  verbucht bei positivem Ack über `commitSteer()` die erfolgreiche Eingabe.

## Tests und Handoff

Regression in `packages/adapters/codex/test/app-server.test.ts` für beide
RPC-Ablehnungen; Hub-Integration für Idempotenz/Queue-Erhalt; E2E für sichtbare
Ablehnung. Transport-Timeout darf nicht als belegte Nichtannahme gelten.
Produktionsfix noch offen. Details und Reparaturplan im
[Audit](../docs/2026-11-13_session-laufzeit-audit.md).
