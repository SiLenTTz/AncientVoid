import { z } from "zod";

/**
 * T4.6 (EPIC-P4 §3 "MCP-Gateway"): the real, fixed catalog of hub
 * operations exposed through `hub_describe`/`hub_exec` — this registry is
 * deliberately NOT part of the gateway's own advertised tool schemas
 * (K4/T4.7 measures only hub_search/hub_describe/hub_exec's own three
 * schemas). It's fetched lazily, which is the entire "Bloat-Vermeidung"
 * point of the meta-tool pattern.
 *
 * Deliberately excludes:
 *  - `approvals.decide` / the WebAuthn decide path: an MCP-connected agent
 *    approving its own write/destructive request would defeat the entire
 *    human-in-the-loop point of the approval system (EPIC-P2). Never
 *    exposed here, on purpose, not an oversight.
 *  - Anything `destructive`-classed: nothing in the hub today creates a
 *    destructive approval through a route an agent could reach anyway
 *    (see EPIC-P2 T2.5's own note that no real destructive action exists
 *    yet), and if one did, it would need WebAuthn — inherently human-only.
 *  - `session.create`/`session.stop`/`session.park`: EPIC-P2 §3's class
 *    table lists "Session starten" as a write-class example, but T2.4
 *    never actually gated session creation behind an approval (only
 *    steer-prompt and budget top-up are really gated today — a real,
 *    already-documented gap, see EPIC-P2's T2.4 evidence). Exposing
 *    ungated session start/stop to an MCP agent would be a real, new
 *    write-capable surface with no approval backing it — left out until
 *    that gap is closed, not silently exposed anyway.
 */

export type OperationClass = "read" | "write";

export interface Operation {
  id: string;
  class: OperationClass;
  description: string;
  argsSchema: z.ZodType;
  /** Builds the real request this operation sends to the hub. */
  request(args: Record<string, unknown>): { method: "GET" | "POST"; path: string; body?: unknown };
}

/**
 * BUG (H-1, independent red-team review, 2026-09-18, T4.10): `sessionId`
 * was only `z.string().min(1)` and got interpolated raw into a path
 * template (e.g. `` `/api/sessions/${sessionId}/steer` ``), then handed
 * to `fetch()`. A crafted id like `"abc-123/stop?"` makes the WHATWG URL
 * parser split the string at the `?`, silently turning a `steer_prompt`
 * call into `POST /api/sessions/abc-123/stop` — reproduced live with
 * `new URL(...)`. Real session ids are ALWAYS `randomUUID()` (never
 * client-supplied — `packages/core/src/modules/sessions/session-manager.ts`'s `create()`),
 * so `.uuid()` both closes the hole and matches the only legitimate
 * shape. `encodeURIComponent()` at every interpolation site below is
 * defense in depth for any *future* operation that doesn't happen to be
 * UUID-shaped — the review's own point that this string-concatenation
 * pattern would keep recurring otherwise.
 */
const SessionIdArgs = z.object({ sessionId: z.string().uuid() });

export const OPERATIONS: Operation[] = [
  {
    id: "sessions.list",
    class: "read",
    description: "List all sessions with their current status, adapter and cost.",
    argsSchema: z.object({}),
    request: () => ({ method: "GET", path: "/api/sessions" }),
  },
  {
    id: "sessions.get",
    class: "read",
    description: "Get one session's full record by id.",
    argsSchema: SessionIdArgs,
    request: (args) => ({ method: "GET", path: `/api/sessions/${encodeURIComponent(SessionIdArgs.parse(args).sessionId)}` }),
  },
  {
    id: "sessions.tail",
    class: "read",
    description: "Read a session's events after a given sequence number.",
    argsSchema: SessionIdArgs.extend({ afterSeq: z.number().int().nonnegative().default(0) }),
    request: (args) => {
      const a = SessionIdArgs.extend({ afterSeq: z.number().int().nonnegative().default(0) }).parse(args);
      return { method: "GET", path: `/api/sessions/${encodeURIComponent(a.sessionId)}/events?afterSeq=${a.afterSeq}` };
    },
  },
  {
    id: "sessions.diff",
    class: "read",
    description: "Get the structured diff (hunks, function anchors) of a session's changes so far.",
    argsSchema: SessionIdArgs,
    request: (args) => ({ method: "GET", path: `/api/sessions/${encodeURIComponent(SessionIdArgs.parse(args).sessionId)}/diff` }),
  },
  {
    id: "approvals.list",
    class: "read",
    description: "List pending and recent approval-queue entries.",
    argsSchema: z.object({ status: z.enum(["pending", "approved", "rejected", "timed_out"]).optional() }),
    request: (args) => {
      const status = z.object({ status: z.enum(["pending", "approved", "rejected", "timed_out"]).optional() }).parse(args).status;
      return { method: "GET", path: `/api/approvals${status ? `?status=${status}` : ""}` };
    },
  },
  {
    id: "sessions.steer_prompt",
    class: "write",
    description:
      "Send a follow-up prompt to a running session. Real hub already parks this behind a write-class human approval when configured (ADR-0007) — this call may return 'pending approval' rather than an immediate result.",
    argsSchema: SessionIdArgs.extend({ text: z.string().min(1) }),
    request: (args) => {
      const a = SessionIdArgs.extend({ text: z.string().min(1) }).parse(args);
      return { method: "POST", path: `/api/sessions/${encodeURIComponent(a.sessionId)}/steer`, body: { kind: "prompt", text: a.text } };
    },
  },
  {
    id: "sessions.budget_topup",
    class: "write",
    description:
      "Request a higher budget for a session parked for exceeding it. Real hub parks this behind a reason-required human approval when configured (ADR-0007).",
    argsSchema: SessionIdArgs.extend({ budgetUsd: z.number().positive(), reason: z.string().min(1).optional() }),
    request: (args) => {
      const a = SessionIdArgs.extend({ budgetUsd: z.number().positive(), reason: z.string().min(1).optional() }).parse(args);
      return {
        method: "POST",
        path: `/api/sessions/${encodeURIComponent(a.sessionId)}/budget`,
        body: { budgetUsd: a.budgetUsd, ...(a.reason ? { reason: a.reason } : {}) },
      };
    },
  },
];

export function findOperation(id: string): Operation | undefined {
  return OPERATIONS.find((o) => o.id === id);
}

/** hub_search: simple, real keyword matching over id+description — no
 * embeddings, no external call, matches the "cheap and local" spirit of
 * this being a static, tiny catalog. */
export function searchOperations(query: string): { id: string; class: OperationClass; description: string }[] {
  const q = query.toLowerCase().trim();
  const terms = q.split(/\s+/).filter(Boolean);
  const scored = OPERATIONS.map((op) => {
    const haystack = `${op.id} ${op.description}`.toLowerCase();
    const score = terms.filter((t) => haystack.includes(t)).length;
    return { op, score };
  }).filter((s) => terms.length === 0 || s.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => ({ id: s.op.id, class: s.op.class, description: s.op.description }));
}
