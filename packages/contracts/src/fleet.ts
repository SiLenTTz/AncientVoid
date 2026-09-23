/**
 * EPIC-P6 / ADR-0017: several hubs in one fleet. Each hub stays the only
 * source of truth for its own sessions; a home hub aggregates and routes.
 */
export const FLEET_PROTOCOL_VERSION = 1;

/** Lowercase slug, stable across restarts, unique within the fleet. */
export const HOST_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

export const HOST_STATES = ["reachable", "stale", "offline", "incompatible", "unauthorized"] as const;
export type HostState = (typeof HOST_STATES)[number];

/** Public answer of every hub: who am I, which protocol do I speak. */
export interface FleetHello {
  hostId: string;
  protocolVersion: number;
  hubVersion: string;
  serverTime: string;
}

/** Turns any machine name into a valid host id. */
export function toHostId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
  return slug.length > 0 ? slug : "hub";
}
