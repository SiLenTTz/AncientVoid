# ADR-0010 — Observability-Contracts (Logger, Health, Metrics)

**Status:** akzeptiert · **Betrifft:** `packages/contracts/src/observability.ts`,
`packages/core/src/logger.ts`, `packages/core/src/metrics.ts`,
`packages/core/src/health.ts`, `packages/server/src/{index,routes,auth,main,ws}.ts`,
T4.5-2/T4.5-3/T4.5-4 (`EPIC-P4.5-testing-observability.md`)

## Kontext

Der Hub loggt bisher über drei getrennte Kanäle: Fastify/pino am HTTP-Rand,
`console.*` in `SessionManager`/`main.ts`, und `AdapterContext.log` (ebenfalls
console). `/api/health` behauptet immer `ok: true` und listet nur Adapter —
keine DB-, EventStore- oder Session-Checks. Es gibt keine Metrics-Fläche.
P5–P12 brauchen beobachtbare Recovery- und Lastzustände (K7/K8/K9), aber das
Produkt bleibt local-first: kein Cloud-APM, kein stilles Egress.

`AdapterContext.log` ist öffentlicher Adapter-SDK und darf die Signatur nicht
brechen (AGENTS.md Regel 2).

## Entscheidung

1. **Neuer Contract** `@ancientvoid/contracts` / `observability.ts`:
   - `HubLogger` — `debug|info|warn|error` plus `child(fields)`.
   - `HubMetrics` — `inc` / `gauge` / `snapshot()`.
   - `HubHealthReport` — additives Schema für `/api/health` (`ok`,
     `adapters`, `serverTime` bleiben; dazu `status`, `uptimeSec`,
     `sessions`, `checks`).
2. **Eine Implementierung** in `@ancientvoid/core`, nicht in `@ancientvoid/server`.
   Server und `hubctl` konsumieren den Contract. Adapter bleiben bei
   `ctx.log(level, msg, extra)` — Core leitet das in den Logger.
3. **Kein Prometheus/OTel.** JSON-Lines nach stdout und ein auth-pflichtiges
   `GET /api/metrics` (Prozesszähler). Nach Hub-Restart stehen die Zähler
   bei 0 — das ist spezifiziert, kein K7-State, kein Snapshot.
4. **Health vs Ready.** `/api/health` bleibt ohne Token (Tailnet, hubctl)
   und antwortet HTTP 200; `ok`/`status` folgen den Checks. `/api/ready`
   ist die Bereitschaftsprobe: 200 nur wenn DB und EventStore probe-ok
   sind, sonst 503. `/api/metrics` erbt die normale API-Auth.
5. **Redaction** teilt sich eine Key-Liste (`authorization`, `token`,
   `cookie`, `password`, `secret`, `apiKey`, `api_key`). Fastify-pino
   `redact` und `redactFields()` verwenden dieselben Keys.

## Konsequenzen

- Bestehende `hubctl health`- und PWA-`hubApi.health`-Aufrufer bleiben gültig
  (additive JSON-Felder).
- `SessionManager`-Konstruktor bekommt ein optionales letztes Argument
  `observability?: { logger?: HubLogger; metrics?: HubMetrics }` — alle
  bisherigen Aufrufer unverändert (console-Default, keine Metrics).
- Tests müssen beweisen: Klartext-Token erscheint nicht; metrics ohne Token
  ist 401; ready wird 503 wenn ein Check rot ist.
- P12 (Dauerlauf, K-Messlatten) nutzt diese Fläche, baut sie nicht neu.
