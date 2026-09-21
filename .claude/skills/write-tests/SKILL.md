---
name: write-tests
description: Schreibt Unit-, Integrations- und E2E-Tests nach der UACC-Testpyramide. Aktiv bei neuem Test, Coverage-Lücke, „wie teste ich das", Playwright, adapter-testkit, rot-dann-grün.
---

# Skill: write-tests

Querschnitts-Regeln: [`AGENTS.md`](../../../AGENTS.md). Architektur-Naht:
[`architecture-best-practices`](../architecture-best-practices/SKILL.md).
Gates danach: [`gates`](../gates/SKILL.md). Observability-Vertrag:
[`docs/adr/0010-observability-contracts.md`](../../../docs/adr/0010-observability-contracts.md).

## Zweck

Jeder neue Test in diesem Repo sitzt in der richtigen Schicht, kreuzt eine
echte Naht und würde ohne den behaupteten Fix oder ohne das neue Verhalten
rot. Dieser Skill ist das Rezept; er ersetzt keine Fachentscheidung.

## Wann benutzen (Trigger)

- neuen Unit-/Integrations-/E2E-Test schreiben
- „wie teste ich das", Coverage-Lücke, Regression
- Playwright, TokenGate, echter Hub, Dummy-Session
- Adapter-Contract (`@uacc/adapter-testkit`)

**Nicht benutzen, wenn:** nur Gates fahren (`gates`); ein Defekt zuerst
reproduziert und dann gefixt werden soll (`bugfix` — der ruft diesen Skill
für den Test).

## Hard Rules

- ✅ Test zuerst so schreiben, dass er **ohne** den Fix/das Feature rot ist.
  Ein sofort grüner Test hat nichts bewiesen.
- ✅ Dieselbe Naht wie der Aufrufer: Adapter nur über `AdapterContext` /
  `adapter-testkit`; HTTP über `createHubApp` + `inject`/`fetch`; PWA-Logik
  über exportierte Funktionen, nicht über interne Render-Tricks.
- ✅ Dateilagen unten, Imports mit `.ts`-Endung, vitest, `forks`-Pool.
- ✅ Secrets, Tokens, Authorization erscheinen in Logs/Fixtures nie im
  Klartext — Redaction-Test oder anonymisierte Fixtures.
- ❌ Kein `setTimeout` als einziges Synchronisationsmittel (fragil in
  diesem Repo). Auf Event, Promise, WS-Frame oder explizites Signal warten.
- ❌ Kein Cloud-Egress im Test. Provider-Streams sind Fixtures.
- ❌ E2E ohne Browser nicht als Pass zählen — `it.skip` / `describe.skip`
  analog tmux (`ADR-0002`).
- ❌ Keine Parameter-Properties, Enums, Namespaces (strip-types).

## Phasen/Prozess

### 1. Schicht wählen

| Frage | Schicht | Lage |
|---|---|---|
| Reine Funktion, Contract, Redaction, Parser? | Unit | `packages/<pkg>/test/<name>.test.ts` |
| Mehrere Module + echter Hub/DB/EventStore? | Integration | `packages/<pkg>/test/<name>.integration.test.ts` oder bestehender `server.test.ts` / `hub-exec-integration.test.ts` |
| Browser, TokenGate, Dashboard, echter Roundtrip? | E2E | `e2e/<name>.test.ts` |
| Neuer Adapter hub-integrierbar? | Contract | `runAdapterContract(adapter)` aus `@uacc/adapter-testkit` |

Bestehende Dateien (`server.test.ts`, `sessionmanager.test.ts`) nicht
umbenennen, nur neue Tests der Konvention folgen lassen.

### 2. Unit

```ts
import { describe, expect, it } from "vitest";
import { redactFields } from "../src/logger.ts";

describe("redactFields", () => {
  it("replaces authorization with [redacted]", () => {
    const out = redactFields({ authorization: "Bearer secret-token" });
    expect(out).toEqual({ authorization: "[redacted]" });
    expect(JSON.stringify(out)).not.toContain("secret-token");
  });
});
```

PWA-DOM (`localStorage`, `document`) vor dem Import stubben — ESM hoistet
`import`, deshalb `await import(...)` nach `Object.defineProperty`.

### 3. Integration

Vorbild: `packages/server/test/server.test.ts`.

1. `mkdtemp` für EventStore, `HubDatabase(":memory:")`.
2. `AdapterRegistry` + `createDummy`, `SessionManager` + `ProcessRunner`.
3. `createHubApp({ ... })`, `app.inject` oder `app.listen({ port: 0 })`.
4. `afterAll`: `app.close()`, `rm(dir, { recursive: true })`.

Auth: Token über `TokenService.issue("label")`. `/api/health` und
`/api/ready` bleiben offen; alles andere unter `/api/` braucht Bearer.

### 4. E2E

```bash
npx playwright install chromium   # einmalig, lokal
npm run test:e2e                  # explizit
npm test                          # Unit+Integration; E2E skippt ohne Browser
```

Rezept: PWA bauen (`npm -w @uacc/pwa run build`), Hub mit `pwaDir` auf
`packages/pwa/dist`, Dummy-Adapter, echtes Token. Chromium öffnet die
Origin, sieht TokenGate, gibt Token ein, sieht „UACC".

```ts
const browserAvailable = await chromium.launch()
  .then((b) => { void b.close(); return true; })
  .catch(() => false);
const itE2e = browserAvailable ? it : it.skip;
```

Kein `itE2e` durch `it` ersetzen, nur damit CI „grün" aussieht.

### 5. Adapter

```ts
import { runAdapterContract } from "@uacc/adapter-testkit";
import { createAdapter } from "../src/index.ts";

const results = await runAdapterContract(createAdapter());
expect(results.every((r) => r.ok)).toBe(true);
```

Provider-spezifische Normalisierung bleibt im eigenen `normalize.test.ts`
gegen anonymisierte Fixtures, nie gegen Live-Cloud.

### 6. Laufen lassen

```bash
npm test                         # vitest: packages/*/test + e2e (skip ok)
npm test -- packages/core/test/logger.test.ts
npm run test:e2e
npm run lint && npm run typecheck
```

Nach dem Schreiben: Gate (`gates`). Ein Test, der nur die eigene Existenz
prüft (`expect(true)`), wird gelöscht, nicht committed.

## Output-Format

```text
Schicht: unit | integration | e2e | contract
Datei: <pfad>
Naht: <Funktion / createHubApp / AdapterContext / Chromium>
Rot ohne Fix: <ja, reproduziert | nein — STOP>
Skip-Bedingung: <keine | kein Chromium | kein tmux>
```

## Determinismus-Checkliste

- [ ] Schicht und Dateilage passen zur Tabelle.
- [ ] Test wäre ohne das behauptete Verhalten rot.
- [ ] Kein Timing-`setTimeout` als einzige Wartebedingung.
- [ ] Kein Klartext-Token in Logs/Fixtures.
- [ ] E2E skippt sichtbar, wenn der Browser fehlt.

## Verweise

- [`AGENTS.md`](../../../AGENTS.md)
- [`gates`](../gates/SKILL.md)
- [`architecture-best-practices`](../architecture-best-practices/SKILL.md)
- [`epics/EPIC-P4.5-testing-observability.md`](../../../epics/EPIC-P4.5-testing-observability.md)
