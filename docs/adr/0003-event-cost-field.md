# ADR-0003 — `costUsd` als optionales Feld auf `EmittedEvent`/`NormalizedEvent`

**Status:** akzeptiert · **Betrifft:** `packages/contracts/src/event.ts`, T1.5 (Monitor-Dashboard)

## Kontext

T1.5 verlangt „Kosten-Aggregation je Session/Tag" im Monitor-Dashboard.
`claude`s `turn.completed`-Äquivalent (`type: "result"`) liefert einen
echten `total_cost_usd`-Wert — bisher landete der nur als
`payload.totalCostUsd` in einem `system`-Event (siehe
`adapter-claude/src/normalize.ts`, Commit `6c52763`).

Damit der Hub Kosten providerneutral aufsummieren kann, ohne
adapter-spezifische Payload-Formen zu kennen (`SessionManager` dürfte
sonst nicht wissen, dass `claude` seine Kosten unter
`payload.kind === "claude.result"` versteckt — eine Kopplung an
Adapter-Interna, die die `AdapterContext`-Grenze umgeht), braucht es ein
stabiles, providerneutrales Feld im Contract selbst.

## Entscheidung

`costUsd?: number` wird ein optionales Feld auf `EmittedEvent` und
`NormalizedEvent`, exakt nach dem Muster des bereits bestehenden
`tokensEst`-Felds (selbe Optionalität, selbe "Adapter kann, muss aber
nicht"-Semantik). Ein Adapter, der eine reale Kosten-Zahl für ein Event
hat, setzt `costUsd` auf **die Kosten dieses einzelnen Turns/Events**
(nicht kumulativ) — `SessionManager` summiert.

- `claude`: `total_cost_usd` aus dem `result`-Event → `costUsd` am
  `system`-Event dieses Turns. `payload.totalCostUsd` entfällt (war
  Duplikat, jetzt eine Quelle).
- `codex`: kein natives Kosten-Feld im Stream (siehe T1.3) → `costUsd`
  bleibt `undefined`. Eine spätere eigene Preistabelle (T1.11) würde
  ebenfalls über dieses Feld einspeisen, nicht über eine zweite,
  parallele Mechanik.
- `dummy`: kein `costUsd` — `capabilities().cost = false`.

`SessionManager.emitEvents()` addiert jedes `costUsd` auf
`SessionRecord.costUsd` (neue Spalte, `DEFAULT 0`, Migration `sessions-cost-and-activity`)
und persistiert es zusammen mit dem ohnehin bei jedem Event aktualisierten
`updatedAt` (ebenfalls neu — „zuletzt aktiv" für die Dashboard-Sortierung,
gleiche Migration).

## Konsequenzen

- `SessionRecord` bekommt zwei neue, rückwärtskompatible Felder
  (`costUsd: number`, `updatedAt: string`) — bestehende Clients, die sie
  ignorieren, sind unbetroffen.
- Kosten-Aggregation "je Tag" (T1.5) geschieht **client-seitig** im
  Dashboard (Gruppierung der ohnehin geladenen Session-Liste nach
  `createdAt`-Datum) — kein neuer Aggregations-Endpunkt, da die
  Session-Liste bereits vollständig geladen wird und die Menge an
  Sessions pro Hub überschaubar ist (K8: 20 gleichzeitige Sessions).
- Ein Adapter, der `costUsd` fälscht oder übertreibt, verfälscht die
  Anzeige — das ist keine neue Angriffsfläche (Adapter-Output war schon
  vorher ungeprüfte Dateneingabe, PWA behandelt sie als Daten, nie als
  Instruktion, AGENTS.md "Datadir & Sicherheit").

## Nachtrag (2026-09-24, ADR-0023)

Wie ehrlich die Summe ist, steht jetzt in `SessionRecord.metrics.cost`
(`unknown`/`partial`/`estimated`/`native`). Geschätzte Werte tragen
`costSource: "estimated"`, und opencode-`cost: 0` gilt nicht mehr als Wert.
