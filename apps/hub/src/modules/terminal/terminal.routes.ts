import { createHash, randomBytes } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  TERMINAL_MAX_ACTIVE,
  TERMINAL_MAX_PENDING_TICKETS,
  TERMINAL_TICKET_TTL_MS,
  type TerminalFrame,
  type TerminalList,
  type TerminalTicket,
} from "@ancientvoid/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import WebSocket, { type RawData } from "ws";
import { extractToken } from "../../platform/auth.ts";

export interface TerminalConfigEntry {
  id: string;
  label: string;
  ssh?: string;
  local?: boolean;
}

const hashTicket = (ticket: string): string => createHash("sha256").update(ticket).digest("hex");

function send(socket: WebSocket, frame: TerminalFrame): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame));
}

function parseFrame(raw: RawData): TerminalFrame | null {
  try {
    const text = Buffer.isBuffer(raw)
      ? raw.toString("utf8")
      : Array.isArray(raw)
        ? Buffer.concat(raw).toString("utf8")
        : Buffer.from(raw).toString("utf8");
    const parsed = JSON.parse(text) as TerminalFrame;
    if (!parsed || typeof parsed !== "object" || !("t" in parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function spawnShell(
  target: TerminalConfigEntry,
  cols: number,
  rows: number,
): ChildProcessWithoutNullStreams {
  const env = {
    ...process.env,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    COLUMNS: String(cols),
    LINES: String(rows),
  };
  if (target.local) {
    // Kein node-pty: `script` allokiert ein PTY ohne natives Addon (Linux).
    return spawn("script", ["-qfc", "bash -l", "/dev/null"], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
  }
  const host = target.ssh!;
  return spawn("ssh", ["-tt", "-o", "BatchMode=yes", host], {
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

/**
 * ADR-0087: Allowlist-Terminals über Ticket-WebSocket.
 * Ohne Config: leere Liste. Spawn nur für konfigurierte ids.
 */
export function registerTerminalRoutes(
  app: FastifyInstance,
  terminals: readonly TerminalConfigEntry[] = [],
): void {
  const byId = new Map(terminals.map((t) => [t.id, t]));
  const tickets = new Map<string, { expiresAt: number; id: string }>();
  let active = 0;

  const prune = (now: number): void => {
    for (const [hash, entry] of tickets) if (entry.expiresAt <= now) tickets.delete(hash);
  };

  app.addHook("preClose", async () => {
    tickets.clear();
  });

  app.get("/api/terminals", async (): Promise<TerminalList> => ({
    terminals: terminals.map(({ id, label, ssh, local }) => ({
      id,
      label,
      ...(ssh ? { ssh } : {}),
      ...(local ? { local: true } : {}),
    })),
  }));

  app.post("/api/terminals/:id/ticket", async (req: FastifyRequest, reply) => {
    const id = (req.params as { id?: string }).id ?? "";
    if (!byId.has(id)) return reply.code(404).send({ error: "Unbekanntes Terminal-Ziel." });
    const token = extractToken(req);
    if (!token) return reply.code(401).send({ error: "device token required" });
    const now = Date.now();
    prune(now);
    if (tickets.size >= TERMINAL_MAX_PENDING_TICKETS) {
      return reply.code(503).send({ error: "Zu viele offene Terminal-Tickets." });
    }
    const ticket = randomBytes(32).toString("base64url");
    const expiresAt = now + TERMINAL_TICKET_TTL_MS;
    tickets.set(hashTicket(ticket), { expiresAt, id });
    const result: TerminalTicket = { ticket, expiresAt };
    return reply.header("cache-control", "no-store").code(201).send(result);
  });

  app.get("/api/terminals/:id/stream", { websocket: true }, (browser, req) => {
    const id = (req.params as { id?: string }).id ?? "";
    const target = byId.get(id);
    const query = req.query as { ticket?: unknown; cols?: unknown; rows?: unknown } | undefined;
    const ticket = query?.ticket;
    const now = Date.now();
    prune(now);
    const ticketHash = typeof ticket === "string" ? hashTicket(ticket) : "";
    const entry = tickets.get(ticketHash);
    if (!target || !entry || entry.expiresAt <= now || entry.id !== id) {
      browser.close(4401, "invalid or expired terminal ticket");
      return;
    }
    tickets.delete(ticketHash);
    if (active >= TERMINAL_MAX_ACTIVE) {
      browser.close(1013, "too many terminal streams");
      return;
    }
    active += 1;

    const cols = Math.min(300, Math.max(20, Number(query?.cols) || 80));
    const rows = Math.min(120, Math.max(8, Number(query?.rows) || 24));
    let child: ChildProcessWithoutNullStreams | undefined;
    let cleaned = false;
    const cleanup = (): void => {
      if (cleaned) return;
      cleaned = true;
      active = Math.max(0, active - 1);
      if (child && !child.killed) {
        child.kill("SIGTERM");
        setTimeout(() => {
          if (child && !child.killed) child.kill("SIGKILL");
        }, 2_000).unref();
      }
    };

    try {
      child = spawnShell(target, cols, rows);
    } catch (err) {
      send(browser, { t: "e", m: err instanceof Error ? err.message : "spawn failed" });
      browser.close(1011, "spawn failed");
      cleanup();
      return;
    }

    child.stdout.on("data", (buf: Buffer) => send(browser, { t: "o", d: buf.toString("utf8") }));
    child.stderr.on("data", (buf: Buffer) => send(browser, { t: "o", d: buf.toString("utf8") }));
    child.on("error", (err) => {
      send(browser, { t: "e", m: err.message.slice(0, 200) });
      browser.close(1011, "child error");
      cleanup();
    });
    child.on("close", (code) => {
      send(browser, { t: "x", code: code ?? -1 });
      if (browser.readyState === WebSocket.OPEN) browser.close(1000, "exit");
      cleanup();
    });

    browser.on("message", (raw) => {
      const frame = parseFrame(raw);
      if (!frame || !child?.stdin.writable) return;
      if (frame.t === "i") {
        child.stdin.write(frame.d);
        return;
      }
      // Resize ohne node-pty: nur Start-COLUMNS/LINES; Hinweis ignorieren (ADR-0087).
    });
    browser.on("close", cleanup);
    browser.on("error", cleanup);
  });
}
