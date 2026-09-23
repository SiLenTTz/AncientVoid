import { FLEET_TOKEN_PREFIX, isFleetRoutable } from "@uacc/contracts";
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
  // ADR-0017: a hub's fleet token only reaches what a home hub may forward.
  const label = opts.tokens.identify(token)?.label ?? "";
  const path = req.url.split("?")[0] ?? req.url;
  if (label.startsWith(FLEET_TOKEN_PREFIX) && !isFleetRoutable(path) && path !== "/api/fleet/pairing") {
    return { ok: false, status: 403, reason: "fleet token not allowed here" };
  }
  return { ok: true };
}

export function authHook(opts: AuthOptions) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    // health/ready stay open for tailnet and process probes (ADR-0010).
    // Strip the query string — `/api/health?foo` must not fall through to 401.
    const path = req.url.split("?")[0] ?? req.url;
    // ADR-0017: hello tells other hubs who this is; no data, no token needed.
    // Pairing is guarded by its one-time code, not a device token.
    if (path === "/api/health" || path === "/api/ready" || path === "/api/fleet/hello" || path === "/api/fleet/pair") return;
    // BUG-0006: everything, including the static PWA shell (index.html,
    // its JS/CSS bundle, manifest, service worker), used to require a
    // device token — but a real browser only carries a URL's ?token= on
    // the document request, never on the <script>/<link> requests that
    // request triggers. A brand-new device could reach TokenGate's own
    // markup at most once (the HTML, via ?token=) and then 401 on the
    // bundle that renders it. The actual protected surface is the API,
    // not the app shell — a SPA's static files are public the same way
    // any other app's install artifact is; auth happens at the data
    // calls. Exempt everything outside /api/ instead of the app shell
    // needing a token it has no way to keep carrying.
    if (!req.url.startsWith("/api/")) return;
    const res = checkAuth(req, opts);
    if (!res.ok) {
      await reply.code(res.status).send({ error: res.reason });
    }
  };
}
