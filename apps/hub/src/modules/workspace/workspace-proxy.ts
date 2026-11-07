import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  WORKSPACE_PREVIEW_MAX_BYTES,
  WORKSPACE_PREVIEW_MAX_PENDING_TICKETS,
  WORKSPACE_PREVIEW_PROXY_TIMEOUT_MS,
  WORKSPACE_PREVIEW_TICKET_TTL_MS,
} from "@ancientvoid/contracts";
import type { RouteContext } from "../../route-context.ts";

/**
 * EPIC-P29 T29.6 / ADR-0051 §6: Mobiler Preview-Zugang auf GENAU den
 * registrierten Loopback-Service einer Session.
 *
 * Isolation (Premortem 5 — „Preview wird SSRF-/Auth-Bypass"):
 * - Ziel ist immer `http://127.0.0.1:<Port der Service-Zeile>` — es gibt
 *   keinen URL-Parameter, keine Host-Übergabe, kein DNS. Kein Open Proxy.
 * - Pfad: validierter Sub-Pfad (kein Traversal/Doppel-Slash/Steuerzeichen).
 * - Query: alles außer `token`/`ticket` wird durchgereicht.
 * - Header: KEIN Client-Header erreicht den Service — insbesondere nie
 *   Authorization (Geräte-Token bliebe sonst im Projekt-Log stehen).
 * - Origin: fremde Origins und `Sec-Fetch-Site: cross-site` werden 403.
 * - Redirects werden nicht verfolgt; nur relative (oder auf den eigenen
 *   Upstream zeigende) Locations gehen zurück, externe werden verworfen.
 * - Methoden: GET/HEAD; WS-Upgrades sind explizit NICHT freigegeben (501).
 * - Auth: Geräte-Token (authHook) ODER ein kurzlebiges, an genau
 *   (Session, Service) gebundenes Ticket (iframe ohne Bearer, STT-Muster).
 */

const hashTicket = (ticket: string): string => createHash("sha256").update(ticket).digest("hex");

const MAX_SUBPATH_CHARS = 512;

/** Validierter Sub-Pfad: "" oder beginnt mit "/", ohne Traversal/Encoding-Tricks. */
export function proxySubPath(raw: string | undefined): string | null {
  // Fastify liefert den Wildcard-Teil ohne führenden "/" — normalisieren.
  const path = raw === undefined || raw === "" ? "" : raw.startsWith("/") ? raw : `/${raw}`;
  if (path === "") return "";
  if (path.length > MAX_SUBPATH_CHARS) return null;
  if (path.includes("//") || path.includes("\\") || path.includes("\0")) return null;
  // sowohl wörtlich als auch kodiert: %2e%2e darf nicht zum Segment werden
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return null;
  }
  if (decoded.includes("\\") || decoded.includes("\0")) return null;
  const segments = decoded.split("/");
  if (segments.some((s) => s === "." || s === "..")) return null;
  return path;
}

/** Query ohne Credentials: `token`/`ticket` fallen weg, der Rest geht durch. */
export function forwardQuery(queryString: string): string {
  if (queryString === "") return "";
  const params = new URLSearchParams(queryString);
  params.delete("token");
  params.delete("ticket");
  const kept = params.toString();
  return kept === "" ? "" : `?${kept}`;
}

const stripDefaultPort = (host: string): string => host.replace(/:80$/, "").replace(/:443$/, "");

/**
 * Origin-Prüfung: ein vorhandener Origin muss vom selben Host kommen wie der
 * Request (Scheme-agnostisch — hinter `tailscale serve` ist das Scheme anders).
 * Sec-Fetch-Site (falls gesendet) muss same-origin/none sein, nie cross-site.
 */
export function originAllowed(origin: string | undefined, host: string | undefined, secFetchSite: string | undefined): boolean {
  if (typeof origin === "string" && origin !== "") {
    if (typeof host !== "string" || host === "") return false;
    try {
      return stripDefaultPort(new URL(origin).host) === stripDefaultPort(host);
    } catch {
      return false;
    }
  }
  if (typeof secFetchSite === "string" && secFetchSite !== "") return secFetchSite === "same-origin" || secFetchSite === "none";
  return true;
}

/** Location einer 3xx-Antwort: relativ bleibt, eigener Upstream wird relativiert, alles andere fällt weg. */
export function rewriteLocation(location: string | undefined, port: number): string | null {
  if (typeof location !== "string" || location === "") return null;
  if (location.startsWith("/") && !location.startsWith("//")) return location;
  try {
    const url = new URL(location);
    if (url.hostname === "127.0.0.1" && url.port === String(port)) return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
  return null;
}

interface PendingTicket {
  sessionId: string;
  serviceId: string;
  expiresAt: number;
}

export function registerWorkspaceProxyRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { deps } = ctx;
  const tickets = new Map<string, PendingTicket>();

  const pruneTickets = (now: number): void => {
    for (const [hash, ticket] of tickets) if (ticket.expiresAt <= now) tickets.delete(hash);
  };

  app.addHook("preClose", async () => {
    tickets.clear();
  });

  app.post("/api/sessions/:id/workspace/services/:serviceId/preview-ticket", async (req, reply) => {
    const { id, serviceId } = req.params as { id: string; serviceId: string };
    const now = Date.now();
    pruneTickets(now);
    if (tickets.size >= WORKSPACE_PREVIEW_MAX_PENDING_TICKETS) return reply.code(503).send({ error: "zu viele offenen Preview-Tickets" });
    if (!deps.sessions.get(id)) return reply.code(404).send({ error: "unknown session" });
    const service = deps.sessions.workspaceService(id, serviceId);
    if (!service) return reply.code(404).send({ error: "unbekannter Service" });
    if (service.state !== "ready") return reply.code(503).send({ error: `Service nicht bereit (${service.state})` });
    const ticket = randomBytes(32).toString("base64url");
    const expiresAt = now + WORKSPACE_PREVIEW_TICKET_TTL_MS;
    tickets.set(hashTicket(ticket), { sessionId: id, serviceId, expiresAt });
    return reply.header("cache-control", "no-store").code(201).send({ ticket, expiresAt });
  });

  const handler = async (req: FastifyRequest, reply: FastifyReply) => {
    const { id, serviceId } = req.params as { id: string; serviceId: string };
    const wildcard = (req.params as { "*": string | undefined })["*"];

    // Explizite WS-Upgrade-Regel: nicht freigegeben (ADR-0051 §6).
    if (typeof req.headers.upgrade === "string" && req.headers.upgrade !== "") {
      return reply.code(501).send({ error: "WS-Upgrades sind im Preview-Proxy nicht freigegeben (ADR-0051 §6)" });
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      return reply.code(405).send({ error: "Preview-Proxy leitet nur GET/HEAD weiter" });
    }

    // Auth: entweder ein gültiges, gebundenes Ticket (der authHook hat diese
    // Anfrage nur wegen des Ticket-Parameters freigestellt) — oder der
    // authHook hat schon ein Geräte-Token geprüft (dann gibt es kein Ticket).
    const queryIndex = req.url.indexOf("?");
    const query = queryIndex >= 0 ? req.url.slice(queryIndex + 1) : "";
    const ticketRaw = new URLSearchParams(query).get("ticket");
    if (ticketRaw !== null) {
      const now = Date.now();
      pruneTickets(now);
      const pending = tickets.get(hashTicket(ticketRaw));
      if (!pending || pending.expiresAt <= now || pending.sessionId !== id || pending.serviceId !== serviceId) {
        return reply.code(401).send({ error: "ungültiges oder abgelaufenes Preview-Ticket" });
      }
    }

    // Ziel NUR aus der Registry-Zeile: kein Host aus dem Request, nie.
    if (!deps.sessions.get(id)) return reply.code(404).send({ error: "unknown session" });
    const service = deps.sessions.workspaceService(id, serviceId);
    if (!service) return reply.code(404).send({ error: "unbekannter Service" });
    if (service.state !== "ready") return reply.code(503).send({ error: `Service nicht bereit (${service.state})` });
    if (typeof service.port !== "number") return reply.code(503).send({ error: "Service ohne registrierten Port" });

    if (!originAllowed(req.headers.origin, req.headers.host, typeof req.headers["sec-fetch-site"] === "string" ? String(req.headers["sec-fetch-site"]) : undefined)) {
      return reply.code(403).send({ error: "fremde Origin" });
    }

    const subPath = proxySubPath(wildcard);
    if (subPath === null) return reply.code(400).send({ error: "unzulässiger Pfad" });
    const target = `http://127.0.0.1:${service.port}${subPath === "" ? "/" : subPath}${forwardQuery(query)}`;

    try {
      // Absichtlich KEINE weitergereichten Client-Header: Authorization,
      // Cookies und Co. erreichen den Service nie (Token-Durchbruch).
      const upstream = await fetch(target, {
        method: req.method,
        redirect: "manual",
        signal: AbortSignal.timeout(WORKSPACE_PREVIEW_PROXY_TIMEOUT_MS),
      });
      const declared = Number(upstream.headers.get("content-length") ?? Number.NaN);
      if (Number.isFinite(declared) && declared > WORKSPACE_PREVIEW_MAX_BYTES) {
        return reply.code(502).send({ error: `Antwort zu groß (${declared} Bytes)` });
      }
      const buffer = Buffer.from(await upstream.arrayBuffer());
      if (buffer.byteLength > WORKSPACE_PREVIEW_MAX_BYTES) {
        return reply.code(502).send({ error: "Antwort zu groß" });
      }
      // Nur geprüfte Header zurück: Typ, Location (3xx, umgeschrieben) —
      // alles andere (Set-Cookie, CSP des Upstream …) fällt weg.
      reply.header("cache-control", "no-store");
      const contentType = upstream.headers.get("content-type");
      if (contentType) reply.header("content-type", contentType);
      if (upstream.status >= 300 && upstream.status < 400) {
        const location = rewriteLocation(upstream.headers.get("location") ?? undefined, service.port);
        if (location !== null) reply.header("location", location);
      }
      return reply.code(upstream.status).send(req.method === "HEAD" ? undefined : buffer);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return reply.code(502).send({ error: `Service nicht erreichbar: ${reason}` });
    }
  };

  // Alle Methoden registriert, der Handler entscheidet — sonst antwortet
  // Fastify 404 statt 405, und „nur GET/HEAD" wäre unsichtbar.
  app.route({
    method: ["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    url: "/api/sessions/:id/workspace/services/:serviceId/proxy",
    handler,
  });
  app.route({
    method: ["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    url: "/api/sessions/:id/workspace/services/:serviceId/proxy/*",
    handler,
  });
}
