import type { NormalizedEvent } from "../../shared/ws.ts";

/** Provider failures a person can sidestep by moving the work elsewhere (not a plain "server hiccup"). */
export const HANDOVER_CATEGORIES = new Set(["auth", "rate_limit", "quota", "network", "server"]);

export interface ProviderFailure {
  category: string;
  title: string;
  detail: string;
}

/** The failure of the CURRENT turn: a provider.error after the last prompt, and no answer after it. */
export function currentProviderFailure(events: readonly NormalizedEvent[]): ProviderFailure | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    const p = e.payload as { kind?: unknown; category?: unknown; title?: unknown; detail?: unknown };
    if (p.kind === "session.prompt" || p.kind === "session.handover_out") return null;
    if (e.type === "assistant") return null;
    if (p.kind === "provider.error") return { category: String(p.category ?? "unknown"), title: String(p.title ?? e.summary), detail: String(p.detail ?? "") };
  }
  return null;
}
