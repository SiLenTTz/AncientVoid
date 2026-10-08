---
id: BUG-0013
slug: mcp-gateway-sessionid-route-confusion
status: done
severity: S2
area: gateway-mcp
instance: dev
commit: ""
forge: ""
epic: "EPIC-P4 T4.10 (independent red-team review)"
created: 2026-09-18
reporter: "Claude Sonnet 5 (autonomous session, via a fresh independent red-team review subagent)"
---

# BUG-0013 — MCP-Gateway: unvalidierte `sessionId` bricht aus dem Pfad-Template aus

## Gesehen

Jede `Operation.request()`-Funktion in `packages/gateway-mcp/src/operations.ts`,
die einen `sessionId`-Pfadparameter baut, interpolierte ihn ungeschützt in
ein Template-Literal (z. B. `` `/api/sessions/${a.sessionId}/steer` ``),
das dann direkt an `fetch()` geht (`packages/gateway-mcp/src/hub-client.ts`:
`fetch(\`${cfg.baseUrl}${req.path}\`, ...)`). `SessionIdArgs` prüfte nur
`z.string().min(1)` — kein Format, keine erlaubten Zeichen.

**Live reproduziert** (echter `new URL()`-Aufruf, dasselbe, was `fetch()`
intern tut):

```js
const sessionId = "abc-123/stop?";
const template = `/api/sessions/${sessionId}/steer`;
// template = "/api/sessions/abc-123/stop?/steer"
new URL("http://127.0.0.1:7373" + template).pathname
// → "/api/sessions/abc-123/stop"   (der Rest wurde zur Query-String)
```

Ein MCP-Client, der `hub_exec(op="sessions.steer_prompt", ...)` mit dieser
`sessionId` aufruft, löst am Hub tatsächlich `POST /api/sessions/abc-123/stop`
aus — also `session.stop`, obwohl `operations.ts`s eigener Doc-Kommentar
`session.stop` **ausdrücklich** als "bewusst nicht exponiert" auflistet
(fehlendes Approval-Gate für Session-Stop). Derselbe Trick mit `..`-Segmenten
(ebenfalls per `new URL()` verifiziert) lenkt die parameterlose
`sessions.get`-Route (`GET /api/sessions/${sessionId}`, kein Suffix) auf
**jede** andere GET-Route unter `/api/` um.

## Erwartet

Ein Client-gelieferter `sessionId`, der die Pfad-Grenze verlassen könnte,
wird abgelehnt, bevor er interpoliert wird — nicht nur "meistens harmlos",
weil die Ziel-Route zufällig ein inkompatibles Body-Schema hat.

## Repro

1. Gateway mit einem echten Hub-Token verbunden (`hub_exec` erreichbar).
2. `hub_exec(op="sessions.steer_prompt", args_json='{"sessionId":"<echte-id>/stop?","text":"x"}')`.
3. Vor dem Fix: Hub führt `POST /api/sessions/<echte-id>/stop` aus, nicht
   `steer`.

**Häufigkeit:** immer, deterministisch — kein Race, kein Timing.

## Umgebung

| Feld | Wert |
|---|---|
| Repro-Weg | `new URL()`-Simulation der exakten `hub-client.ts`-Aufrufkette |
| Betroffene Operationen | `sessions.get`, `sessions.tail`, `sessions.diff`, `sessions.steer_prompt`, `sessions.budget_topup` — jede, die `sessionId` in einen Pfad interpoliert |

## Eingrenzung

`packages/gateway-mcp/src/operations.ts` — `SessionIdArgs` (vor dem Fix
`z.string().min(1)`, keine Formatprüfung) + fünf Interpolationsstellen.

## Fix

- `SessionIdArgs` verlangt jetzt `z.string().uuid()` — echte Session-IDs
  sind immer `randomUUID()` (`packages/core/src/sessionmanager.ts`s
  `create()`, nie client-geliefert), also ist das die einzig legitime Form
  UND schließt die Lücke strukturell (kein `/`, `?`, `.` in einer UUID).
- Zusätzlich, als Verteidigung gegen zukünftige, nicht UUID-förmige
  Operationen: jede Interpolationsstelle wrapt den Wert jetzt mit
  `encodeURIComponent()` — der Fund selbst weist darauf hin, dass dieses
  String-Concatenation-Muster sich sonst wiederholen würde.

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `packages/gateway-mcp/test/operations.test.ts` — "rejects a non-UUID sessionId outright — closes the real path-confusion exploit (H-1)" | rot (Schema akzeptierte `"abc-123/stop?"` und `"../tokens"`) |
| Unit | dito, bestehende Tests auf echtes UUID-Fixture (`SID`) umgestellt statt Platzhalter `"abc-123"` | angepasst, weiterhin grün |
| Integration | `packages/gateway-mcp/test/hub-exec-integration.test.ts` (unverändert, nutzt bereits echte `record.id`) | weiterhin grün |

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue angelegt — GitLab aktuell nicht erreichbar (Gitaly-Ausfall,
      s. Session-Historie); lokal gefixt und getestet, Push steht aus.
- [x] Direkt gefixt (kein separater `bugfix`-Durchlauf nötig)
