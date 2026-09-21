import { discoveryDedupeKey, type DiscoveredSession } from "@uacc/contracts";

/**
 * Hub records win over a later external observation of the same native id.
 * Items without a native id stay distinct by hub id (ADR-0011).
 */
export function dedupeDiscovered(items: readonly DiscoveredSession[]): DiscoveredSession[] {
  const seen = new Map<string, DiscoveredSession>();
  for (const item of items) {
    const key = discoveryDedupeKey(item);
    const prev = seen.get(key);
    if (!prev || (!prev.hubSessionId && item.hubSessionId)) seen.set(key, item);
  }
  return [...seen.values()];
}

export function pageDiscovered(
  items: readonly DiscoveredSession[],
  cursor: number,
  limit: number,
): { items: DiscoveredSession[]; nextCursor: number | null } {
  const start = Math.max(0, cursor);
  const slice = items.slice(start, start + limit);
  const next = start + slice.length;
  return { items: slice, nextCursor: next < items.length ? next : null };
}
