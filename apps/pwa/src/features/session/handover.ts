import type { NormalizedEvent } from "../../shared/ws.ts";

/** Provider failures a person can sidestep by moving the work elsewhere (not a plain "server hiccup").
 * BUG-0123: "session" — the agent lost the provider session; repair in place or hand over. */
export const HANDOVER_CATEGORIES = new Set(["auth", "rate_limit", "quota", "network", "server", "session"]);

export interface ProviderFailure {
  category: string;
  title: string;
  detail: string;
}

/** The failure of the CURRENT turn: a provider.error after the last prompt, and no answer after it.
 * BUG-0123: the lost native session belongs here too — a session.start_failed
 * “Resource not found: not found: <id>” (pre-fix tails) or the adapter's
 * acp.context_lost. The bar offers repair (same session) and handover. */
export function currentProviderFailure(events: readonly NormalizedEvent[]): ProviderFailure | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    const p = e.payload as { kind?: unknown; category?: unknown; title?: unknown; detail?: unknown; error?: unknown; cause?: unknown };
    if (p.kind === "session.prompt" || p.kind === "session.handover_out") return null;
    if (e.type === "assistant") return null;
    if (p.kind === "provider.error") return { category: String(p.category ?? "unknown"), title: String(p.title ?? e.summary), detail: String(p.detail ?? "") };
    if (p.kind === "acp.context_lost") return { category: "session", title: "Agent hat den Verlauf verloren", detail: String(p.cause ?? e.summary) };
    if (p.kind === "session.start_failed" && /resource not found/i.test(String(p.error ?? ""))) {
      return { category: "session", title: "Provider-Session verloren", detail: String(p.error ?? "") };
    }
  }
  return null;
}
