import { BRIDGE_TOKEN_PREFIX } from "./tool-permission.ts";
import { FLEET_TOKEN_PREFIX } from "../fleet/fleet.ts";
import { COMPANION_TOKEN_PREFIX } from "../desktop/desktop.ts";

/**
 * T7.4: who acts, and what each actor may do — one table for every route,
 * the MCP gateway included. The server checks it; a hidden button protects
 * nothing (ADR-0018).
 *
 * Actors come from the token label:
 * - `agent:<name>` — an AI agent (e.g. the MCP gateway): may read, and
 *   request writes, but every write waits for a human; never decides.
 * - `bridge:<session>` — the permission bridge: asks and waits only
 *   (routes restricted in auth).
 * - `fleet:<home>` — a home hub forwarding a human's phone (ADR-0017).
 * - `companion:<pc>` — the desktop companion (ADR-0031): fetches what a
 *   person asked it to type and reports back; nothing else.
 * - anything else — a human's device.
 */
export const AGENT_TOKEN_PREFIX = "agent:";

export type ActorKind = "human" | "fleet" | "agent" | "bridge" | "companion";

export function actorKind(label: string | null | undefined): ActorKind {
  if (!label) return "human";
  if (label.startsWith(AGENT_TOKEN_PREFIX)) return "agent";
  if (label.startsWith(BRIDGE_TOKEN_PREFIX)) return "bridge";
  if (label.startsWith(FLEET_TOKEN_PREFIX)) return "fleet";
  if (label.startsWith(COMPANION_TOKEN_PREFIX)) return "companion";
  return "human";
}

/** allow: runs now · approve: waits for a human decision · deny: 403 */
export type PolicyDecision = "allow" | "approve" | "deny";

export const POLICY_OPERATIONS = [
  "read",
  "sessions.create",
  "loops.start",
  "loops.onboard",
  "sessions.prompt",
  "sessions.park",
  "sessions.stop",
  "sessions.budget",
  "sessions.apply",
  "sessions.archive",
  "approvals.decide",
  "tokens.manage",
  "fleet.manage",
  "fleet.unpair",
  "skills.write",
  "tools.ask",
  "attachments.upload",
  "settings.manage",
  "actions.run",
  "drafts.write",
  "push.subscribe",
  "voice.transcribe",
  "media.analyze",
  "desktop.act",
  "desktop.companion",
] as const;
export type PolicyOperation = (typeof POLICY_OPERATIONS)[number];

const HUMAN: PolicyDecision = "allow";

/**
 * The table. Humans (and a home hub acting for them) act directly — the
 * emergency stop above all. An agent requests; a human decides.
 */
export const POLICY: Readonly<Record<PolicyOperation, Readonly<Record<ActorKind, PolicyDecision>>>> = {
  read: { human: HUMAN, fleet: "allow", agent: "allow", bridge: "deny", companion: "deny" },
  "sessions.create": { human: HUMAN, fleet: "allow", agent: "approve", bridge: "deny", companion: "deny" },
  /** EPIC-P19 (AC-P19-8): ein Loop hat Außenwirkung (Merge in `dark`) — nur ein Mensch am eigenen Gerät. */
  "loops.start": { human: HUMAN, fleet: "deny", agent: "deny", bridge: "deny", companion: "deny" },
  /** Legt eine Linie mit Repo-Token an (Außenwirkung auf dem Host): nur ein Mensch. */
  "loops.onboard": { human: HUMAN, fleet: "deny", agent: "deny", bridge: "deny", companion: "deny" },
  "sessions.prompt": { human: HUMAN, fleet: "allow", agent: "approve", bridge: "deny", companion: "deny" },
  "sessions.park": { human: HUMAN, fleet: "allow", agent: "approve", bridge: "deny", companion: "deny" },
  "sessions.stop": { human: HUMAN, fleet: "allow", agent: "approve", bridge: "deny", companion: "deny" },
  "sessions.budget": { human: HUMAN, fleet: "allow", agent: "approve", bridge: "deny", companion: "deny" },
  "sessions.apply": { human: HUMAN, fleet: "allow", agent: "deny", bridge: "deny", companion: "deny" },
  "sessions.archive": { human: HUMAN, fleet: "allow", agent: "deny", bridge: "deny", companion: "deny" },
  "approvals.decide": { human: HUMAN, fleet: "allow", agent: "deny", bridge: "deny", companion: "deny" },
  "tokens.manage": { human: HUMAN, fleet: "deny", agent: "deny", bridge: "deny", companion: "deny" },
  "fleet.manage": { human: HUMAN, fleet: "deny", agent: "deny", bridge: "deny", companion: "deny" },
  /** A paired home hub removes its own pairing (ADR-0017). */
  "fleet.unpair": { human: HUMAN, fleet: "allow", agent: "deny", bridge: "deny", companion: "deny" },
  "skills.write": { human: HUMAN, fleet: "allow", agent: "deny", bridge: "deny", companion: "deny" },
  /** T7.2: a provider asks before a tool runs — the bridge's only job. */
  "tools.ask": { human: "deny", fleet: "deny", agent: "deny", bridge: "allow", companion: "deny" },
  /** T7.10: files into sessions — from a person's device (or their home hub). */
  "attachments.upload": { human: HUMAN, fleet: "allow", agent: "deny", bridge: "deny", companion: "deny" },
  /** T7.10: hub settings incl. the Gemini key — this hub's own devices only. */
  "settings.manage": { human: HUMAN, fleet: "deny", agent: "deny", bridge: "deny", companion: "deny" },
  /** T7.6: registered test/git/tool actions — a person's button. An agent
   * runs its tools inside its own harness, gated there (T7.2). */
  "actions.run": { human: HUMAN, fleet: "allow", agent: "deny", bridge: "deny", companion: "deny" },
  /** T8.4: a person's unsent reply — agents neither read nor write it. */
  "drafts.write": { human: HUMAN, fleet: "allow", agent: "deny", bridge: "deny", companion: "deny" },
  /** T8.3: a device subscribes itself to Web Push. */
  "push.subscribe": { human: HUMAN, fleet: "deny", agent: "deny", bridge: "deny", companion: "deny" },
  /** T10.2: a person's own voice — not something an agent sends in. */
  "voice.transcribe": { human: HUMAN, fleet: "allow", agent: "deny", bridge: "deny", companion: "deny" },
  /** EPIC-P10.5: the hub fetches and analyses a video — a person's request. */
  "media.analyze": { human: HUMAN, fleet: "allow", agent: "deny", bridge: "deny", companion: "deny" },
  /** EPIC-P11: a person's dictation typed on a PC — never an agent's. */
  "desktop.act": { human: HUMAN, fleet: "deny", agent: "deny", bridge: "deny", companion: "deny" },
  /** EPIC-P11: the companion fetches its work and reports — its only job. */
  "desktop.companion": { human: "deny", fleet: "deny", agent: "deny", bridge: "deny", companion: "allow" },
};

export function policyFor(operation: PolicyOperation, label: string | null | undefined): PolicyDecision {
  return POLICY[operation][actorKind(label)];
}
