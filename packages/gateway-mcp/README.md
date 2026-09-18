# `@uacc/gateway-mcp` — MCP sidecar (T4.6/T4.7, EPIC-P4)

Exposes the hub to an MCP-speaking agent (e.g. Claude Desktop, or Claude
Code itself) through exactly three meta-tools — never more, per the
lazy-disclosure pattern this task exists to demonstrate:

- **`hub_search(query)`** — finds relevant hub operations by keyword.
  Returns name + one-line description only (no schemas — ~20–100 tokens
  per hit).
- **`hub_describe(op)`** — full JSON argument schema for one operation
  found via `hub_search`.
- **`hub_exec(op, args_json)`** — validates arguments against that schema
  and really calls the hub's REST API. A `write`-class operation may come
  back `{"ok": false, "detail": "pending approval …"}` — the gateway
  cannot force it through; a human still has to approve it from the hub's
  own Freigaben queue (ADR-0007). No `destructive`-classed operation, and
  no way to *decide* a pending approval, is ever exposed here — see
  `src/operations.ts`'s own doc comment for why.

## Default OFF — this is the whole point (AC-P4-5)

`packages/server/src/main.ts` never imports or starts this package. A
fresh clone's hub exposes **zero** MCP surface until you explicitly run
this process yourself, with your own real credentials:

```bash
# Issue a real device token for the gateway (it's a device like any other)
node packages/hubctl/src/cli.ts token issue "mcp-gateway" --db data/hub.db

UACC_GATEWAY_URL=http://127.0.0.1:7373 \
UACC_GATEWAY_TOKEN=<the token from above> \
npm run gateway-mcp
```

Point your MCP client's config at this command (stdio transport). Example
for a client using an `mcpServers` JSON config:

```json
{
  "mcpServers": {
    "uacc-hub": {
      "command": "node",
      "args": ["packages/gateway-mcp/src/main.ts"],
      "env": {
        "UACC_GATEWAY_URL": "http://127.0.0.1:7373",
        "UACC_GATEWAY_TOKEN": "<real device token>"
      }
    }
  }
}
```

## K4 — static token budget

`test/k4-token-budget.test.ts` measures the real `tools/list` manifest
(via a real MCP client/server round trip, not a hand-copied duplicate) and
fails if it ever exceeds 1000 tokens (~4 chars/token, the same estimator
`custom-rag`'s own real code uses) — a real CI gate against Premortem 1
("Gateway wird 'noch schnell' um zwei Conveniences-Tools erweitert"). A
fourth tool needs an ADR and an updated budget, not a quiet addition.

## Adding an operation

Add one entry to `src/operations.ts`'s `OPERATIONS` array: `id`, `class`
(`"read"` or `"write"` — see that file for why `"destructive"` never
appears here), `description`, a zod `argsSchema`, and a `request()`
function building the real hub REST call. Nothing else needs to change —
`hub_search`/`hub_describe`/`hub_exec` all read from this one registry.
