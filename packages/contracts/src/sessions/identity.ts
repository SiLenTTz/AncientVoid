/**
 * Session identity for discovery and handoff (ADR-0011, EPIC-P5).
 * Hub id stays stable. External identity is host + provider + native id.
 */

/** "mirror" — a read-only chat view of an externally observed session
 * (ADR-0011 Erweiterung): refreshed from the provider's own store, no
 * adapter of its own, no steering. */
export const CONTROL_MODES = ["observed", "managed", "controllable", "mirror"] as const;
export type ControlMode = (typeof CONTROL_MODES)[number];

export const HARNESS_TARGETS = ["cli", "ide", "desktop-app"] as const;
export type HarnessTarget = (typeof HARNESS_TARGETS)[number];

/** Bump only with a migration. Newer versions are visible and refused. */
export const RESUME_SCHEMA_VERSION = 1;

export const DEFAULT_HOST_ID = "local";

export interface DiscoveredSession {
  hubSessionId: string | null;
  project: string;
  adapter: string;
  status: string;
  controlMode: ControlMode;
  harness: HarnessTarget;
  hostId: string;
  nativeSessionId: string | null;
  resumeVersion: number;
  observedAt: string;
  unsupportedResume: boolean;
  fork: boolean;
  /** Set for a subagent transcript whose parent session id is known. */
  parentSessionId: string | null;
  /** ADR-0040: what the session is about — provider title, else the first
   * prompt. Display only, never identity. Absent = source cannot tell. */
  title?: string | null;
  /** ADR-0040: the last thing said in it (≤ 160 chars), display only. */
  preview?: string | null;
  /** ADR-0040: an external harness wrote to it moments ago — probably still
   * open there. Continuing it must fork, not share the transcript. */
  live?: boolean;
}

export interface DiscoverySource {
  id: string;
  list(): Promise<DiscoveredSession[]>;
}

export function discoveryDedupeKey(item: Pick<DiscoveredSession, "hostId" | "adapter" | "nativeSessionId" | "hubSessionId">): string {
  if (item.nativeSessionId) return `${item.hostId}\0${item.adapter}\0${item.nativeSessionId}`;
  return `hub\0${item.hubSessionId ?? ""}`;
}

export function unsupportedResume(version: number): boolean {
  return version !== RESUME_SCHEMA_VERSION;
}
