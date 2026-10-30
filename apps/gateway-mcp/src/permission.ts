import { request } from "node:http";
import { request as requestTls } from "node:https";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * T7.2 / ADR-0018 §3: the permission bridge. claude runs it through
 * `--mcp-config` and calls its one tool before every tool that needs a
 * decision (`--permission-prompt-tool mcp__uacc__permission`). The bridge
 * hands the request to the hub and waits for the phone's answer.
 *
 * It carries a token bound to one session that may only ask and wait
 * (`bridge:<session>`), never decide. It polls instead of holding one long
 * request: a hub restart in between costs a few retries, not the answer
 * (the request itself is persisted, ADR-0019).
 */
export interface BridgeConfig {
  hubUrl: string;
  token: string;
  sessionId: string;
  /** Give up and deny after this long without an answer from the hub. */
  maxWaitMs?: number;
  /** Pause between retries while the hub is unreachable. */
  retryMs?: number;
}

type HubReply = { status: number; body: Record<string, unknown> };

/** node:http without keep-alive — Node 26's fetch stalls on reused sockets. */
function call(cfg: BridgeConfig, method: "GET" | "POST", path: string, body?: unknown): Promise<HubReply> {
  const url = new URL(path, cfg.hubUrl);
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const send = url.protocol === "https:" ? requestTls : request;
  return new Promise((resolve, reject) => {
    const req = send(
      url,
      {
        method,
        agent: false,
        headers: {
          authorization: `Bearer ${cfg.token}`,
          ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}),
        },
        timeout: 40_000,
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => (text += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: {} });
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function askHub(
  cfg: BridgeConfig,
  ask: { tool_name: string; input: Record<string, unknown>; tool_use_id?: string | undefined },
): Promise<{ behavior: "allow"; updatedInput: Record<string, unknown> } | { behavior: "deny"; message: string }> {
  const deadline = Date.now() + (cfg.maxWaitMs ?? 60 * 60_000);
  const retry = cfg.retryMs ?? 2000;
  const base = `/api/sessions/${encodeURIComponent(cfg.sessionId)}/tool-permissions`;
  let id: string | null = null;
  while (Date.now() < deadline) {
    try {
      if (!id) {
        const created = await call(cfg, "POST", base, {
          toolName: ask.tool_name,
          input: ask.input,
          ...(ask.tool_use_id ? { toolUseId: ask.tool_use_id } : {}),
        });
        if (created.status === 201 && typeof created.body.id === "string") id = created.body.id;
        else if (created.status >= 400 && created.status < 500) {
          return { behavior: "deny", message: `Der Hub nimmt die Anfrage nicht an (${String(created.body.error ?? created.status)}) — nicht ausgeführt.` };
        } else {
          await sleep(retry);
        }
        continue;
      }
      const poll = await call(cfg, "GET", `${base}/${encodeURIComponent(id)}?waitMs=20000`);
      if (poll.status === 200 && poll.body.state === "answered") {
        return poll.body.answer as { behavior: "allow"; updatedInput: Record<string, unknown> } | { behavior: "deny"; message: string };
      }
      if (poll.status === 404) return { behavior: "deny", message: "Der Hub kennt die Anfrage nicht mehr — nicht ausgeführt." };
      if (poll.status !== 200) await sleep(retry);
    } catch {
      await sleep(retry); // hub restarting or unreachable — the request is persisted
    }
  }
  return { behavior: "deny", message: "Keine Antwort vom Hub — nicht ausgeführt." };
}

export const PERMISSION_TOOL = "permission";

export function buildPermissionServer(cfg: BridgeConfig): McpServer {
  const server = new McpServer({ name: "uacc", version: "0.1.0" });
  server.registerTool(
    PERMISSION_TOOL,
    {
      description: "Asks the human on the AncientVoid hub whether a tool may run. Used by --permission-prompt-tool, not by the model.",
      inputSchema: { tool_name: z.string(), input: z.record(z.string(), z.unknown()), tool_use_id: z.string().optional() },
    },
    async (args) => {
      const answer = await askHub(cfg, args);
      return { content: [{ type: "text", text: JSON.stringify(answer) }] };
    },
  );
  return server;
}
