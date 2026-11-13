import type { HubApi } from "../../shared/api.ts";
import type { NormalizedEvent } from "../../shared/ws.ts";
import { isOffloaded, withBlobPayload } from "./event-text.ts";
import { useEffect, useMemo, useState } from "preact/hooks";

const caches = new WeakMap<HubApi, Map<string, Promise<string>>>();

/** Gleiche Blobs teilen eine Anfrage; Host und Session gehören zum Zugriffskontext. */
export function fetchEventBlob(api: HubApi, event: NormalizedEvent): Promise<string> {
  let cache = caches.get(api);
  if (!cache) caches.set(api, (cache = new Map()));
  const key = `${event.sessionId}:${event.blobRef}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const request = api.eventBlob(event.sessionId, event.blobRef!).catch((error: unknown) => {
    cache.delete(key);
    throw error;
  });
  if (cache.size >= 200) cache.delete(cache.keys().next().value!);
  cache.set(key, request);
  return request;
}

export function useFullEvent(event: NormalizedEvent, api: HubApi): { event: NormalizedEvent; state: "ok" | "loading" | "failed" } {
  const [loaded, setLoaded] = useState<{ ref: string | null; event: NormalizedEvent | null } | null>(null);
  const offloaded = isOffloaded(event);
  useEffect(() => {
    if (!offloaded) return;
    let alive = true;
    void fetchEventBlob(api, event).then((raw) => {
      const full = withBlobPayload(event, raw);
      if (alive) setLoaded({ ref: event.blobRef, event: isOffloaded(full) ? null : full });
    }, () => { if (alive) setLoaded({ ref: event.blobRef, event: null }); });
    return () => { alive = false; };
  }, [api, offloaded, event.blobRef, event.sessionId]);
  if (!offloaded) return { event, state: "ok" };
  if (loaded?.ref === event.blobRef) return { event: loaded.event ?? event, state: loaded.event ? "ok" : "failed" };
  return { event, state: "loading" };
}

/** Vor der Schrittzuordnung nachladen: K5-Platzhalter enthalten weder Tool-ID noch Namen. */
export function useChatEvents(events: NormalizedEvent[], api: HubApi) {
  const [loaded, setLoaded] = useState<Map<string, NormalizedEvent | null>>(new Map());
  const keyOf = (e: NormalizedEvent) => `${e.sessionId}:${e.seq}:${e.blobRef}`;
  const needed = events.filter((e) => isOffloaded(e) && (e.type === "tool_use" || e.type === "tool_result" || e.type === "thinking"));
  useEffect(() => {
    let alive = true;
    const batch = needed.filter((e) => !loaded.has(keyOf(e))).slice(0, 4);
    if (batch.length === 0) return;
    void Promise.all(batch.map(async (event) => {
      try {
        const full = withBlobPayload(event, await fetchEventBlob(api, event));
        return [keyOf(event), isOffloaded(full) ? null : full] as const;
      } catch {
        return [keyOf(event), null] as const;
      }
    })).then((results) => {
      if (alive) setLoaded((prev) => {
        const next = new Map(prev);
        const kept = new Set(needed.map(keyOf));
        for (const key of next.keys()) if (!kept.has(key)) next.delete(key);
        for (const [key, value] of results) next.set(key, value);
        return next;
      });
    });
    return () => { alive = false; };
  }, [events, api, loaded]);
  return {
    events: useMemo(() => events.map((e) => loaded.get(keyOf(e)) ?? e), [events, loaded]),
    failed: needed.some((e) => loaded.get(keyOf(e)) === null),
    retry: () => setLoaded((prev) => new Map([...prev].filter(([, value]) => value !== null))),
  };
}
