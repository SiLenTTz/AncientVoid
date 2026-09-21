/**
 * Session identity for discovery and handoff (ADR-0011, EPIC-P5).
 * Hub id stays stable. External identity is host + provider + native id.
 */

export const CONTROL_MODES = ["observed", "managed", "controllable"] as const;
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
