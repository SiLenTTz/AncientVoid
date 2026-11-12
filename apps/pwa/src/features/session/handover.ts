import { currentProviderFailureFromEvents, type VisibleProviderFailure } from "@ancientvoid/contracts";
import type { NormalizedEvent } from "../../shared/ws.ts";

/** Provider failures a person can sidestep by moving the work elsewhere (not a plain "server hiccup").
 * BUG-0126: "session" — the agent lost the provider session; repair in place or hand over. */
export const HANDOVER_CATEGORIES = new Set(["auth", "rate_limit", "quota", "network", "server", "session"]);

export type ProviderFailure = VisibleProviderFailure;

/** The failure of the CURRENT turn: a provider.error after the last prompt, and no answer after it.
 * BUG-0126: the lost native session belongs here too. BUG-0149: Cursor's
 * quota line (`cursor.usage_limit`) and a promptless resume do not hide it. */
export function currentProviderFailure(events: readonly NormalizedEvent[]): ProviderFailure | null {
  return currentProviderFailureFromEvents(events);
}
