import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { findOperation, searchOperations } from "./operations.ts";
import { callHub, type HubClientConfig } from "./hub-client.ts";

/**
 * T4.6 (EPIC-P4 §3): exactly three tools, no more — K4/T4.7 measures the
 * static token cost of these three schemas and fails the build if a
 * fourth is ever added without a matching ADR + token-budget update
 * (Premortem 1: "Gateway wird 'noch schnell' um zwei Conveniences-Tools
 * erweitert").
 */
export function buildGatewayServer(cfg: HubClientConfig): McpServer {
  const server = new McpServer({ name: "uacc-hub-gateway", version: "0.1.0" });

  server.registerTool(
    "hub_search",
    {
      description: "Find relevant hub operations by keyword. Returns name + one-line description only, no schemas.",
      inputSchema: { query: z.string().min(1) },
    },
    async ({ query }) => {
      const matches = searchOperations(query);
      return { content: [{ type: "text", text: JSON.stringify(matches) }] };
    },
  );

  server.registerTool(
    "hub_describe",
    {
      description: "Get the full argument schema for one hub operation found via hub_search.",
      inputSchema: { op: z.string().min(1) },
    },
    async ({ op }) => {
      const found = findOperation(op);
      if (!found) {
        return { content: [{ type: "text", text: JSON.stringify({ error: `unknown operation "${op}"` }) }], isError: true };
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              id: found.id,
              class: found.class,
              description: found.description,
              argsSchema: z.toJSONSchema(found.argsSchema),
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "hub_exec",
    {
      description:
        "Execute a hub operation found via hub_search/hub_describe. write-class operations may come back as 'pending approval' — a real human must approve them from the hub's own approval queue, this tool cannot force it through.",
      inputSchema: { op: z.string().min(1), args_json: z.string() },
    },
    async ({ op, args_json }) => {
      const found = findOperation(op);
      if (!found) {
        return { content: [{ type: "text", text: JSON.stringify({ error: `unknown operation "${op}"` }) }], isError: true };
      }
      let parsedArgs: unknown;
      try {
        parsedArgs = JSON.parse(args_json);
      } catch {
        return { content: [{ type: "text", text: JSON.stringify({ error: "args_json is not valid JSON" }) }], isError: true };
      }
      const validated = found.argsSchema.safeParse(parsedArgs);
      if (!validated.success) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "argument validation failed", issues: validated.error.issues }) }],
          isError: true,
        };
      }
      const result = await callHub(cfg, found.request(validated.data as Record<string, unknown>));
      return { content: [{ type: "text", text: JSON.stringify(result.body) }], isError: result.status >= 400 };
    },
  );

  return server;
}
