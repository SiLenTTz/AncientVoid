#!/usr/bin/env node
/**
 * hubctl — reference client for the UACC hub.
 *
 *   UACC_URL=https://hub.tailnet.ts.net UACC_TOKEN=… hubctl sessions
 *   hubctl tail <sessionId> -f
 *   hubctl token issue "pixel-9"          (issues against local hub DB file)
 */
import { pathToFileURL } from "node:url";
import type { NormalizedEvent } from "@uacc/contracts";

const BASE = process.env.UACC_URL ?? "http://127.0.0.1:7373";
const TOKEN = process.env.UACC_TOKEN ?? "";

/** Exported for unit testing — building this by hand (vs. the URL API) is
 * exactly how BUG-0005 (ws:://host, an invalid URL) slipped in unnoticed. */
export function buildWsUrl(base: string, token: string, sessionId: string): string {
  const proto = base.startsWith("https") ? "wss" : "ws";
  const url = `${proto}:${base.replace(/^https?:/, "")}/api/events/${sessionId}/tail${token ? `?token=${encodeURIComponent(token)}` : ""}`;
  return url;
}

/** Exported so additive /api/health fields stay printed (ADR-0010) instead
 * of being silently ignored by the reference client. */
export function formatHealth(h: {
  ok: boolean;
  status?: string;
  adapters: { id: string; version: string }[];
  checks?: { database?: { ok: boolean }; eventStore?: { ok: boolean } };
  sessions?: { live: number; total: number };
}): string[] {
  const lines = [`ok: ${h.ok}${h.status ? `  status=${h.status}` : ""}`];
  if (h.sessions) lines.push(`  sessions live=${h.sessions.live} total=${h.sessions.total}`);
  if (h.checks) {
    const db = h.checks.database?.ok ? "ok" : "fail";
    const store = h.checks.eventStore?.ok ? "ok" : "fail";
    lines.push(`  checks db=${db} store=${store}`);
  }
  for (const a of h.adapters) lines.push(`  adapter ${a.id}@${a.version}`);
  return lines;
}

function usage(): never {
  console.log(`hubctl — UACC reference client

Usage:
  hubctl health
  hubctl adapters
  hubctl sessions
  hubctl show <sessionId>
  hubctl events <sessionId> [afterSeq]
  hubctl tail <sessionId> [-f]
  hubctl token issue <label> [--db <hub.db>]
  hubctl token list [--db <hub.db>]
  hubctl token revoke <label> [--db <hub.db>]

Env:
  UACC_URL   hub base url (default http://127.0.0.1:7373)
  UACC_TOKEN device token`);
  process.exit(1);
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(`${res.status} ${res.statusText}: ${body.error ?? ""}`);
  }
  return (await res.json()) as T;
}

interface SessionRow {
  id: string;
  adapter: string;
  project: string;
  status: string;
  createdAt: string;
  lastSeq: number;
}

function printSession(s: SessionRow): void {
  const short = s.id.slice(0, 8);
  console.log(`${short}  ${s.status.padEnd(18)} ${s.adapter.padEnd(10)} #${String(s.lastSeq).padEnd(6)} ${s.project}`);
}

async function* followWs(sessionId: string): AsyncGenerator<NormalizedEvent> {
  const socket = new WebSocket(buildWsUrl(BASE, TOKEN, sessionId));
  const queue: NormalizedEvent[] = [];
  let wake: (() => void) | null = null;
  socket.onmessage = (msg: MessageEvent) => {
    const data = JSON.parse(String(msg.data)) as { type: string; events?: NormalizedEvent[] };
    if (data.type === "events" && data.events) {
      queue.push(...data.events);
      wake?.();
    }
  };
  const opened = new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve();
    socket.onerror = (e) => reject(new Error(`ws error: ${String(e)}`));
  });
  await opened;
  socket.send(JSON.stringify({ type: "hello", lastSeq: 0 }));
  while (true) {
    if (queue.length === 0) {
      await new Promise<void>((resolve) => {
        wake = resolve;
        setTimeout(resolve, 30_000);
      });
      wake = null;
      continue;
    }
    const batch = queue.splice(0, queue.length);
    for (const ev of batch) yield ev;
  }
}

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case "health": {
      const h = await api<{
        ok: boolean;
        status?: string;
        adapters: { id: string; version: string }[];
        checks?: { database?: { ok: boolean }; eventStore?: { ok: boolean } };
        sessions?: { live: number; total: number };
      }>("/api/health");
      for (const line of formatHealth(h)) console.log(line);
      break;
    }
    case "adapters": {
      const list = await api<{ id: string; version: string; capabilities: Record<string, boolean> }[]>(
        "/api/adapters",
      );
      for (const a of list) {
        const caps = Object.entries(a.capabilities)
          .filter(([, v]) => v)
          .map(([k]) => k)
          .join(",");
        console.log(`${a.id}@${a.version}  [${caps}]`);
      }
      break;
    }
    case "sessions": {
      const sessions = await api<SessionRow[]>("/api/sessions");
      if (sessions.length === 0) console.log("(no sessions)");
      for (const s of sessions) printSession(s);
      break;
    }
    case "show": {
      const id = args[0] ?? usage();
      const s = await api<SessionRow>(`/api/sessions/${id}`);
      console.log(JSON.stringify(s, null, 2));
      break;
    }
    case "events": {
      const id = args[0] ?? usage();
      const after = args[1] ?? "0";
      const events = await api<NormalizedEvent[]>(`/api/sessions/${id}/events?afterSeq=${after}`);
      for (const e of events) printEvent(e);
      break;
    }
    case "tail": {
      const id = args[0] ?? usage();
      const follow = args.includes("-f");
      if (follow) {
        for await (const ev of followWs(id)) printEvent(ev);
      } else {
        const events = await api<NormalizedEvent[]>(`/api/sessions/${id}/events`);
        for (const e of events) printEvent(e);
      }
      break;
    }
    case "token": {
      const sub = args[0] ?? usage();
      const dbIdx = args.indexOf("--db");
      const dbPath = dbIdx >= 0 ? (args[dbIdx + 1] ?? "data/hub.db") : "data/hub.db";
      if (sub === "issue") {
        const label = args[1] ?? usage();
        const { TokenService, HubDatabase } = await import("@uacc/core");
        const tokens = new TokenService(new HubDatabase(dbPath));
        const issued = tokens.issue(label);
        console.log(`token for "${label}" (shown once):\n  ${issued.token}`);
      } else if (sub === "list") {
        const { TokenService, HubDatabase } = await import("@uacc/core");
        const tokens = new TokenService(new HubDatabase(dbPath));
        for (const t of tokens.list()) console.log(`${t.label}  created=${t.createdAt} lastUsed=${t.lastUsedAt ?? "never"}`);
      } else if (sub === "revoke") {
        const label = args[1] ?? usage();
        const { TokenService, HubDatabase } = await import("@uacc/core");
        const tokens = new TokenService(new HubDatabase(dbPath));
        console.log(`revoked: ${tokens.revoke(label)}`);
      } else {
        usage();
      }
      break;
    }
    default:
      usage();
  }
}

function printEvent(e: NormalizedEvent): void {
  const time = e.ts.slice(11, 19);
  const blob = e.blobRef ? " ⛁blob" : "";
  console.log(`${time} #${String(e.seq).padEnd(4)} ${e.type.padEnd(11)} ${e.summary.slice(0, 90)}${blob}`);
}

// Only run when executed directly (`node cli.ts ...` / the `hubctl` bin) —
// not when imported as a module (e.g. cli.test.ts importing buildWsUrl).
// Found while adding that very test: without this guard, importing this
// file for its exports ran the full CLI as a side effect and called
// process.exit(1) via usage(), polluting the test run.
const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error("hubctl:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
