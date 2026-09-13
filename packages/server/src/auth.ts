import type { FastifyRequest, FastifyReply } from "fastify";
import type { TokenService } from "@uacc/core";

/**
 * Auth (PRD §8): Tailnet-only deployment, device-token bearer auth.
 * When `enforceTailnetIdentity` is on, requests must carry the Tailscale
 * identity headers injected by `tailscale serve` — direct LAN hits bounce.
 */
export interface AuthOptions {
  tokens: TokenService;
  enforceTailnetIdentity: boolean;
}

export const TAILSCALE_LOGIN_HEADER = "tailscale-user-login";

export function extractToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice("Bearer ".length).trim();
  const q = (req.query as Record<string, string> | undefined)?.token;
  return typeof q === "string" && q.length > 0 ? q : null;
}

export function checkAuth(req: FastifyRequest, opts: AuthOptions): { ok: true } | { ok: false; status: number; reason: string } {
  if (opts.enforceTailnetIdentity && !req.headers[TAILSCALE_LOGIN_HEADER]) {
    return { ok: false, status: 401, reason: "missing tailnet identity (serve via tailscale)" };
  }
  const token = extractToken(req);
  if (!token) return { ok: false, status: 401, reason: "missing device token" };
  if (!opts.tokens.verify(token)) return { ok: false, status: 401, reason: "invalid device token" };
  return { ok: true };
}

export function authHook(opts: AuthOptions) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    // health stays open for tailnet monitoring
    if (req.url === "/api/health") return;
    const res = checkAuth(req, opts);
    if (!res.ok) {
      await reply.code(res.status).send({ error: res.reason });
    }
  };
}
