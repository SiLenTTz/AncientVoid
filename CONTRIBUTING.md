# Contributing zu UACC

Danke, dass du beisteuern willst! Dieses Projekt lebt von der Modulgrenze —
wenn du sie respektierst, ist dein Beitrag fast immer klein und lokal.

## Der schnellste Weg: ein eigener Adapter

Du willst einen **eigenen Provider**, ein **Coding-Tool** oder ein **lokales
Coding-System** anbinden? Dafür musst du den Hub nicht forken. Ein Adapter
ist ein einzelnes Modul:

```ts
// adapters/my-provider/adapter.ts
import type { Adapter, AdapterContext, SessionHandle } from "@uacc/contracts";

export function createAdapter(config?: Record<string, unknown>): Adapter {
  return {
    id: "my-provider",
    version: "0.1.0",
    capabilities: () => ({ reasoning: false, tools: false, cost: false, steer: false }),
    async start(spec, ctx) {
      ctx.emit({ type: "system", summary: "started", payload: {} });
      return { sessionId: ctx.sessionId };
    },
    async steer(handle, input, ctx) { return { ok: true }; },
    async status() { return { state: "healthy" }; },
    async stop() {},
  };
}
```

In `hub.config.json` eintragen:

```json
{ "adapters": [ { "id": "my-provider", "module": "./adapters/my-provider/adapter.ts" } ] }
```

Hub neu starten — fertig. Details, Regeln und das Testkit:
**[`docs/adapters.md`](./docs/adapters.md)**. Vollständiges, lauffähiges
Beispiel: [`examples/adapters/openai-compat/`](./examples/adapters/openai-compat/).

## Andere Einstiegspunkte

| Du willst … | Ort |
|---|---|
| Adapter beisteuern (npm-Paket `uacc-adapter-*`) | `docs/adapters.md` |
| Adapter-Verhalten verändern/erweitern | `packages/contracts/src/adapter.ts` + ADR |
| Anderen Worker-Runner (z. B. WSL, remote) | `packages/workers/` (`WorkerRunner`-Interface) |
| Frontend | `packages/pwa/` (Preact, bewusst klein) |
| Doku/Epics | `docs/`, `epics/` |

## Verpflichtend für jeden Beitrag

1. `npm test && npm run lint && npm run typecheck` — grün.
2. Adapter: Contract-Suite aus `@uacc/adapter-testkit` grün (siehe
   `packages/adapter-dummy/test/contract.test.ts` als Vorlage).
3. Keine Secrets, keine Roh-Logs. `data/` bleibt git-ignored.
4. Neue Komponenten brauchen Contract-Bezug (AGENTS.md, Regel 1 & 5).
5. Conventions aus `AGENTS.md` gelten für Menschen und Agenten gleichermaßen.

## Contract-Stabilität

`@uacc/contracts` ist öffentliche API. Breaking Changes dort brauchen ein ADR
(`docs/adr/NNN-*.md`) und eine Major-Version. Alles andere ist intern und darf
sich bewegen.

## Commits / PRs

- Conventional Commments (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`).
- Ein Thema pro PR; Contract-Änderungen getrennt von Implementierungen.
- CI (GitLab) führt `test`, `lint`, `typecheck` aus — grün vor Merge.
