import { discoveryDedupeKey, type DiscoveredSession } from "@uacc/contracts";

/**
 * Hub records win over a later external observation of the same native id.
 * Items without a native id stay distinct by hub id (ADR-0011). The loser
 * still lends what the winner lacks (ADR-0040): the provider's own title,
 * last words and the "open elsewhere" mark.
 */
export function dedupeDiscovered(items: readonly DiscoveredSession[]): DiscoveredSession[] {
  const seen = new Map<string, DiscoveredSession>();
  for (const item of items) {
    // A hub record that ended in `error` (e.g. a failed adoption) must not hide
    // the external session behind it — that one stays continuable (ADR-0040).
    const key = item.hubSessionId && item.status === "error" ? `hub\0${item.hubSessionId}` : discoveryDedupeKey(item);
    const prev = seen.get(key);
    if (!prev) {
      seen.set(key, item);
      continue;
    }
    const [winner, other] = !prev.hubSessionId && item.hubSessionId ? [item, prev] : [prev, item];
    seen.set(key, {
      ...winner,
      title: winner.title ?? other.title ?? null,
      preview: winner.preview ?? other.preview ?? null,
      live: winner.live === true || other.live === true,
    });
  }
  return [...seen.values()];
}

/** Server-side search: a phrase must match title, preview, project or id —
 * paging happens after, so a hit on page 9 is not lost. */
export function filterDiscovered(items: readonly DiscoveredSession[], query: { q?: string; adapter?: string }): DiscoveredSession[] {
  const terms = (query.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((item) => {
    if (query.adapter && item.adapter !== query.adapter) return false;
    if (terms.length === 0) return true;
    const haystack = `${item.title ?? ""} ${item.preview ?? ""} ${item.project} ${item.adapter} ${item.nativeSessionId ?? ""} ${item.hubSessionId ?? ""}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
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
