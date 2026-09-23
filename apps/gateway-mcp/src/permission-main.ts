#!/usr/bin/env node
/**
 * T7.2: entry point of the permission bridge. Started by claude from the
 * per-session MCP config the hub writes (mode 0600, token inside — never on
 * a command line).
 *
 *   UACC_HUB_URL=http://127.0.0.1:7373 UACC_BRIDGE_TOKEN=… UACC_SESSION_ID=…
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildPermissionServer } from "./permission.ts";

const hubUrl = process.env.UACC_HUB_URL;
const token = process.env.UACC_BRIDGE_TOKEN;
const sessionId = process.env.UACC_SESSION_ID;
if (!hubUrl || !token || !sessionId) {
  console.error("[uacc-permission] UACC_HUB_URL, UACC_BRIDGE_TOKEN and UACC_SESSION_ID are required.");
  process.exit(1);
}
await buildPermissionServer({ hubUrl, token, sessionId }).connect(new StdioServerTransport());
