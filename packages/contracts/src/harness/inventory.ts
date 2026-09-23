import type { HarnessTarget } from "../sessions/identity.ts";

/**
 * Audit §4 states. A fallback must not be recorded as verified.
 * T5.1 / ADR-0012.
 */
export const SUPPORT_STATES = ["verified", "implemented-unverified", "missing", "blocked"] as const;
export type SupportState = (typeof SUPPORT_STATES)[number];

/** What this adapter itself does with sessions it did not start. */
export const NATIVE_DISCOVERY = ["read-only", "none"] as const;
export type NativeDiscovery = (typeof NATIVE_DISCOVERY)[number];

/** Whether this adapter resumes an existing native session id. */
export const NATIVE_RESUME = ["native", "none"] as const;
export type NativeResume = (typeof NATIVE_RESUME)[number];

export interface HarnessCatalogEntry {
  id: string;
  harness: HarnessTarget;
  /** Empty when there is no binary to probe (model endpoint, missing adapter). */
  command: string;
  args: readonly string[];
  discovery: SupportState;
  resume: SupportState;
  evidence: string;
  /** T5.5: arguments that continue a native session in this harness's own
   * terminal UI; `{id}` stands for the native session id. */
  openArgs?: readonly string[];
}

export interface HarnessInventoryEntry {
  id: string;
  harness: HarnessTarget;
  version: string | null;
  discovery: SupportState;
  resume: SupportState;
  evidence: string;
}
