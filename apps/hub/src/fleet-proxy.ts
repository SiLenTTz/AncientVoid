import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import WebSocket from "ws";
import type { FleetStore, SessionManager, TokenService } from "@uacc/core";
import type { HubMetrics } from "@uacc/contracts";
import { isFleetRoutable } from "@uacc/contracts";
import { createTailHandler } from "./ws.ts";

const FORWARD_TIMEOUT_MS = 10_000;
const MAX_FORWARD_BYTES = 16 * 1024 * 1024;

interface Forwarded {
  status: number;
  contentType: string;
  body: Buffer;
}

function forward(url: string, method: string, token: string, body: unknown): Promise<Forwarded> {
  const target = new URL(url);
  const payload = body === undefined || body === null || method === "GET" ? undefined : JSON.stringify(body);
  const request = target.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = request(
      target,
      {
        method,
        agent: false,
        headers: {
          authorization: `Bearer ${token}`,
          ...(payload === undefined ? {} : { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_FORWARD_BYTES) req.destroy(new Error("response too large"));
          else chunks.push(chunk);
        });
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 502, contentType: String(res.headers["content-type"] ?? "application/json"), body: Buffer.concat(chunks) }),
        );
      },
    );
    req.setTimeout(FORWARD_TIMEOUT_MS, () => req.destroy(new Error(`no answer within ${FORWARD_TIMEOUT_MS / 1000} s`)));
    req.on("error", reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

/** `/api/<rest>` if it is a clean, routable path — no `..`, no `//`. */
function routablePath(rest: string): string | null {
  const path = `/api/${rest}`;
  if (new URL(path, "http://hub").pathname !== path || path.includes("//")) return null;
  return isFleetRoutable(path) ? path : null;
}

/**
 * T6.4 / ADR-0017: `/api/hosts/<hostId>/<path>` reaches exactly that host —
 * locally for this hub's own id, else the paired peer's stored URL with its
 * fleet token, only for routable paths. Events stream through as well.
 */
export function registerFleetProxy(
  app: FastifyInstance,
  deps: { fleet: FleetStore; hostId: string; sessions: SessionManager; tokens: TokenService; metrics?: HubMetrics },
): void {
  const local = createTailHandler(deps.sessions, deps.metrics, deps.tokens);

  app.get("/api/hosts/:hostId/events/:id/tail", { websocket: true }, (socket, req) => {
    const { hostId, id } = req.params as { hostId: string; id: string };
    if (hostId === deps.hostId) {
      local(socket, req);
      return;
    }
    const peer = deps.fleet.peer(hostId);
    if (!peer) {
      socket.close(4404, "unknown host");
      return;
    }
    const upstream = new WebSocket(`${peer.url.replace(/^http/, "ws")}/api/events/${encodeURIComponent(id)}/tail?token=${encodeURIComponent(peer.token)}`);
    const pending: string[] = [];
    socket.on("message", (data: Buffer) => {
      const text = data.toString();
      if (upstream.readyState === WebSocket.OPEN) upstream.send(text);
      else pending.push(text);
    });
    upstream.on("open", () => {
      for (const text of pending.splice(0)) upstream.send(text);
    });
    upstream.on("message", (data: Buffer) => {
      if (socket.readyState === socket.OPEN) socket.send(data.toString());
    });
    upstream.on("close", (code) => socket.close(code >= 4000 ? code : 1011, "host stream ended"));
    upstream.on("error", () => socket.close(1011, "host unreachable"));
    socket.on("close", () => upstream.close());
  });

  const handler = async (req: FastifyRequest, reply: FastifyReply) => {
    const { hostId, "*": rest } = req.params as { hostId: string; "*": string };
    const path = routablePath(rest);
    if (!path) return reply.code(403).send({ error: "path not routable to other hosts", hostId });
    const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    if (hostId === deps.hostId) {
      const res = await app.inject({
        method: req.method as "GET",
        url: `${path}${query}`,
        headers: { authorization: String(req.headers.authorization ?? "") },
        ...(req.body === undefined ? {} : { payload: req.body as object }),
      });
      return reply.code(res.statusCode).type(String(res.headers["content-type"] ?? "application/json")).send(res.rawPayload);
    }
    const peer = deps.fleet.peer(hostId);
    if (!peer) return reply.code(404).send({ error: "unknown host", hostId });
    try {
      const res = await forward(`${peer.url}${path}${query}`, req.method, peer.token, req.body);
      if (res.status === 401 || res.status === 403) {
        return reply.code(502).send({ error: `${hostId} lehnt den Zugriff ab (Kopplung widerrufen?)`, hostId, state: "unauthorized" });
      }
      return reply.code(res.status).type(res.contentType).send(res.body);
    } catch (err) {
      return reply.code(502).send({ error: `${hostId} nicht erreichbar: ${err instanceof Error ? err.message : String(err)}`, hostId, state: "offline" });
    }
  };
  app.route({ method: ["GET", "POST", "DELETE"], url: "/api/hosts/:hostId/*", handler });
}
