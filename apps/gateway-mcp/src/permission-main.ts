#!/usr/bin/env node
/**
 * T7.2: entry point of the permission bridge. Started by claude from the
 * per-session MCP config the hub writes (mode 0600, token inside — never on
 * a command line).
 *
 *   ANCIENTVOID_HUB_URL=http://127.0.0.1:7373 ANCIENTVOID_BRIDGE_TOKEN=… ANCIENTVOID_SESSION_ID=…
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildPermissionServer } from "./permission.ts";

const hubUrl = process.env.ANCIENTVOID_HUB_URL;
const token = process.env.ANCIENTVOID_BRIDGE_TOKEN;
const sessionId = process.env.ANCIENTVOID_SESSION_ID;
if (!hubUrl || !token || !sessionId) {
  console.error("[ancientvoid-permission] ANCIENTVOID_HUB_URL, ANCIENTVOID_BRIDGE_TOKEN and ANCIENTVOID_SESSION_ID are required.");
  process.exit(1);
}
await buildPermissionServer({ hubUrl, token, sessionId }).connect(new StdioServerTransport());
