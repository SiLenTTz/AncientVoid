import type { FastifyReply, FastifyRequest } from "fastify";
import { policyFor, type PolicyDecision, type PolicyOperation } from "@ancientvoid/contracts";
import type { TokenService } from "@ancientvoid/core";
import { extractToken } from "./auth.ts";

/**
 * T7.4: every API route maps to one policy operation; the decision comes
 * from the shared table (contracts/approvals/policy.ts). `deny` ends here
 * with 403; `approve` is left to the route (it files an approval instead
 * of acting). Unmapped writes count as deny for agents — fail closed.
 */
export function operationOf(method: string, url: string, body: unknown): PolicyOperation | null {
  const path = url.split("?")[0] ?? url;
  // Asking and polling alike: the bridge's own route, nobody else's.
  if (/^\/api\/sessions\/[^/]+\/tool-permissions/.test(path)) return "tools.ask";
  // T8.4: drafts are a person's, reading included.
  if (/^\/api\/sessions\/[^/]+\/draft$/.test(path)) return "drafts.write";
  // EPIC-P11: the companion's long poll is a GET, but not a read.
  if (path.startsWith("/api/desktop/companion/")) return "desktop.companion";
  // EPIC-P49 (ADR-0063 §4): Der Vault ist eine Menschenfläche — auch das Lesen
  // ist keine allgemeine Lese-Operation, sondern settings.manage (Agenten: deny).
  if (path.startsWith("/api/vault")) return "settings.manage";
  if (method === "GET" || method === "HEAD") return "read";
  if ((path === "/api/stt" || path === "/api/stt/stream-ticket") && method === "POST") return "voice.transcribe";
  if (path.startsWith("/api/media/")) return "media.analyze";
  if (path.startsWith("/api/desktop/")) return "desktop.act";
  // T9.3: planning is reading; executing runs every step through the real
  // route with the caller's own token — that route's policy decides.
  if (path.startsWith("/api/commands/")) return "read";
  if (/^\/api\/sessions\/[^/]+\/actions\/[^/]+$/.test(path)) return "actions.run";
  if (/^\/api\/loops\/[^/]+\/onboard$/.test(path)) return "loops.onboard";
  // ADR-0043: Factory-Lauf starten/steuern — Außenwirkung, nur Menschen (Policy-Tabelle).
  if (path === "/api/factory/start") return "factory.start";
  if (/^\/api\/factory\/[^/]+\/command$/.test(path)) return "factory.control";
  if (path === "/api/sessions") return (body as { loop?: unknown } | undefined)?.loop ? "loops.start" : "sessions.create";
  if (/^\/api\/sessions\/[^/]+\/steer$/.test(path)) {
    const kind = (body as { kind?: unknown } | undefined)?.kind;
    return kind === "resume" ? "sessions.resume" : kind === "park" ? "sessions.park" : kind === "stop" ? "sessions.stop" : "sessions.prompt";
  }
  if (/^\/api\/sessions\/[^/]+\/resume$/.test(path)) return "sessions.resume";
  if (/^\/api\/sessions\/[^/]+\/stop$/.test(path)) return "sessions.stop";
  if (/^\/api\/sessions\/[^/]+\/budget$/.test(path)) return "sessions.budget";
  if (/^\/api\/sessions\/[^/]+\/apply$/.test(path)) return "sessions.apply";
  if (/^\/api\/sessions\/[^/]+\/(archive|meta)$/.test(path)) return "sessions.archive";
  // EPIC-P29 T29.6: Workspace-Retry führt genehmigte argv erneut aus —
  // nur ein Mensch (ADR-0051 §3); Preview-Ticket ebenso an die Person gebunden.
  if (/^\/api\/sessions\/[^/]+\/workspace\/retry$/.test(path)) return "workspace.retry";
  if (/^\/api\/sessions\/[^/]+\/workspace\/services\/[^/]+\/preview-ticket$/.test(path)) return "workspace.preview";
  if (/^\/api\/approvals\/[^/]+\/(decide|webauthn\/)/.test(path)) return "approvals.decide";
  if (path.startsWith("/api/tokens") || path.startsWith("/api/webauthn/register")) return "tokens.manage";
  if (path === "/api/fleet/pairing") return "fleet.unpair";
  if (path.startsWith("/api/fleet/")) return "fleet.manage";
  if (path === "/api/skills") return "skills.write";
  if (path.startsWith("/api/attachments")) return "attachments.upload";
  if (path.startsWith("/api/settings") || path.startsWith("/api/vault") || path === "/api/push/enabled") return "settings.manage";
  if (path.startsWith("/api/push/")) return "push.subscribe";
  if (path === "/api/prompt-enhance" || path === "/api/prompt-recommendation" || path === "/api/prompt-optimizer/feedback") return "read";
  return null;
}

declare module "fastify" {
  interface FastifyRequest {
    /** T7.4: set when this actor may only request, not act. */
    policy?: { decision: PolicyDecision; actor: string };
  }
}

export function policyHook(tokens: TokenService) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.url.startsWith("/api/")) return;
    const token = extractToken(req);
    const label = token ? (tokens.identify(token)?.label ?? null) : null;
    // BUG-0108: a token that verifies but carries no label is no actor —
    // it must not silently inherit the human row (actorKind("") would).
    // Unattributable means fail closed, no route left.
    if (token && label === "") {
      await reply.code(403).send({ error: "Token ohne Label — nicht zuordenbar, fail closed" });
      return;
    }
    if (!label) return; // public routes (auth already let them through)
    const operation = operationOf(req.method, req.url, req.body);

    const decision: PolicyDecision = operation ? policyFor(operation, label) : policyFor("tokens.manage", label) === "allow" ? "allow" : "deny";
    if (decision === "deny") {
      await reply.code(403).send({ error: `Nicht erlaubt für ${label}: ${operation ?? `${req.method} ${req.url.split("?")[0]}`}` });
      return;
    }
    req.policy = { decision, actor: label };
  };
}
