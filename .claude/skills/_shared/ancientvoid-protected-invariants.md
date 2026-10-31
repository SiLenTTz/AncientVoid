# AncientVoid-Protected Invariants

> **Vertrag, den `ponytail-review` nie als `delete`/`yagni` flaggt.** Bei
> Treffer gilt `architecture-guard:`. Querschnitts-Regeln:
> [`AGENTS.md`](../../../AGENTS.md) (Architektur-Regeln 1–6).
>
> Diese Liste beschreibt den _Ist-Vertrag im Repo_, nicht den Wunschzettel.
> Was hier nicht steht, ist kein Invariant — spekulativer Code bleibt `yagni`.

Diese Datei ist die einzige Liste. `ponytail-review` verweist hierher.

## Übersicht

| # | Invariant | Durchgesetzt durch | Nicht im Vertrag |
|---|---|---|---|
| 1 | `AdapterContext`-Grenze | `packages/contracts/src/adapter.ts` (Typsystem, Review) | ein Enforcement-Linter — fehlt |
| 2 | K5 — Payload ≤ 4 KB | `EventStore` (mechanisch), `MAX_EVENT_PAYLOAD_BYTES` | Kompression der Blobs selbst |
| 3 | K7 — State aus JSONL+Snapshot rekonstruierbar | `EventStore`-Replay, `adapter.recover()` | Cross-Session-Recovery |
| 4 | `NormalizedEvent`: `seq`/`ts`/`sessionId` nur vom Hub | `EmittedEvent` (Zod, `.omit`) in `packages/contracts/src/event.ts` | Adapter-seitige Zeitstempel als Anker |
| 5 | Kein `child_process.spawn` direkt in Adaptern | Review, `docs/adapters.md` Anti-Patterns | ein automatischer Scan — fehlt |

## 1 — `AdapterContext`-Grenze

Ein Adapter sieht nur `AdapterContext` (`emit`, `blob`, `spawnWorker`, `log`,
`signal`, `workdir`, `sessionId`) — keine Hub-Internas, keine Imports aus
`@ancientvoid/core` oder `@ancientvoid/server` (`AGENTS.md` Regel 2).

**Guard:** jeder Import in `packages/adapter-*/src/**` gegen `@ancientvoid/core`
oder `@ancientvoid/server` ist ein Blocker im Review.
**Nicht guard:** `@ancientvoid/contracts`-Imports — das ist genau die erlaubte Naht.

## 2 — K5 (Event-Payload ≤ 4 KB)

Der `EventStore` erzwingt es mechanisch (`MAX_EVENT_PAYLOAD_BYTES = 4096` in
`packages/contracts/src/event.ts`), aber Adaptern soll es nicht egal sein:
alles Große (Rohausgabe, Diffs, große Tool-Ergebnisse) gehört via
`ctx.blob()` ausgelagert, der Event-Payload bleibt ein Anker.

**Guard:** `ctx.blob()`-Nutzung für alles > ~2 KB.
**Nicht guard:** ein zweiter, ungenutzter Kappungs-Mechanismus neben dem
EventStore — das wäre `shrink`/`delete`.

## 3 — K7 (Recovery)

Zustand ist aus JSONL + Snapshot rekonstruierbar. Jede neue State-Quelle
(z. B. ein neuer Adapter mit eigenem In-Memory-State) braucht einen
Recovery-Pfad — entweder über `adapter.recover()` oder durch bewusste
Dokumentation, warum die Session nach einem Hub-Crash als `error` gilt.

**Guard:** `recover()`-Implementierungen und die Snapshot/Replay-Logik in
`@ancientvoid/core`.
**Nicht guard:** ein `recover()`, das nichts tut außer `return null` —
das ist eine ehrliche Nichtimplementierung, kein Invariant-Bruch.

## 4 — `NormalizedEvent`-Schema

`seq`, `ts` (i. d. R.) und `sessionId` werden vom Hub vergeben, nicht vom
Adapter. `EmittedEvent` (was ein Adapter tatsächlich übergibt) omittiert
`seq`/`sessionId` bewusst und macht `ts` optional — das ist kein Zufall,
sondern der Vertrag.

**Guard:** die `.omit`/`.extend`-Definition von `EmittedEvent` gegenüber
`NormalizedEvent`.
**Nicht guard:** ein Adapter, der zusätzlich einen eigenen `payload.ts`-Wert
für Debugging mitschickt — das ist Nutzdaten, kein Schema-Bruch.

## 5 — Kein direktes `child_process.spawn` in Adaptern

Prozesse laufen ausschließlich über `ctx.spawnWorker()` — das hält Worker
attachbar, reapbar und austauschbar (ADR-P0-3, `docs/adapters.md`
Anti-Patterns).

**Guard:** jeder `child_process`-Import außerhalb von `packages/workers/`.
**Nicht guard:** `packages/workers/` selbst — dort lebt die Implementierung
des Runners.

## Wie `ponytail-review` sie benutzt

- Invariant-Treffer → `architecture-guard:`, nie `delete`/`yagni`.
- Indirection, die den Vertrag _durchsetzt_ (EventStore-Kappung, Zod-Schema),
  ist gewollt.
- Eine zweite, ungenutzte Kopie desselben Mechanismus → `shrink:` oder
  `delete:`.
- Lücken (z. B. Approval-Queue für `swarm`-Gates, siehe
  [`docs/adr/0001-swarm-adapter-context.md`](../../../docs/adr/0001-swarm-adapter-context.md))
  sind **kein** Auftrag, sie nebenbei zu bauen. Neues gehört ins zuständige
  Epic.

## Verweise

- [`AGENTS.md`](../../../AGENTS.md) Architektur-Regeln 1–6
- [`docs/adapters.md`](../../../docs/adapters.md)
- [`architecture-best-practices`](../architecture-best-practices/SKILL.md)
