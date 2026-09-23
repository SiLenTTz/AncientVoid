#!/usr/bin/env node
/**
 * T4.6/AC-P4-5 (EPIC-P4): the MCP sidecar's actual entry point — and the
 * ENTIRE reason "default off" holds: apps/hub/src/main.ts never
 * imports or spawns this file. A fresh clone's hub exposes zero MCP
 * surface until someone explicitly runs this process with real
 * credentials, by hand or via their own MCP client config (e.g. Claude
 * Desktop's `mcpServers` config pointing at this file).
 *
 *   UACC_GATEWAY_URL=http://127.0.0.1:7373 \
 *   UACC_GATEWAY_TOKEN=<a real device token, e.g. from `hubctl token issue`> \
 *   node apps/gateway-mcp/src/main.ts
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildGatewayServer } from "./server.ts";

const baseUrl = process.env.UACC_GATEWAY_URL;
const token = process.env.UACC_GATEWAY_TOKEN;
if (!baseUrl || !token) {
  console.error("[gateway-mcp] UACC_GATEWAY_URL and UACC_GATEWAY_TOKEN are both required — refusing to start without real hub credentials.");
  process.exit(1);
}

const server = buildGatewayServer({ baseUrl, token });
await server.connect(new StdioServerTransport());
console.error(`[gateway-mcp] connected (stdio), hub=${baseUrl}`);
