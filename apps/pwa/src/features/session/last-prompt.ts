import type { NormalizedEvent } from "../../shared/ws.ts";
import type { HubApi } from "../../shared/api.ts";
import { useEffect, useState } from "preact/hooks";

export function lastUserPrompt(
  events: readonly NormalizedEvent[],
): NormalizedEvent | null {
  for (let i = events.length - 1; i >= 0; i--)
    if (events[i]!.type === "user") return events[i]!;
  return null;
}

/** Der letzte Auftrag bleibt auch bei langen Zügen Teil der begrenzten Projektion (K2/K10).
 *
 * `floorSeq` (BUG-0211): die unterste Folge, die bewusst gehalten wird — weil nach oben
 * gescrollt und aeltere Eintraege geladen wurden. Ab dieser Folge wird nichts mehr
 * verworfen; die Grenze gilt nur fuer das, was darueber liegt. Ohne floorSeq (0) bleibt es
 * beim bisherigen Fenster der juengsten `limit` Eintraege. */
export function tailWindow(
  events: NormalizedEvent[],
  limit: number,
  floorSeq = 0,
): NormalizedEvent[] {
  const kept =
    floorSeq > 0
      ? events.reduce((n, e) => n + (e.seq >= floorSeq ? 1 : 0), 0)
      : 0;
  const take = Math.max(limit, kept);
  if (events.length <= take) return events;
  const tail = events.slice(-take);
  const prompt = lastUserPrompt(events);
  return prompt && prompt.seq < tail[0]!.seq
    ? [prompt, ...tail.slice(1)]
    : tail;
}

/** Die WebSocket-Baseline enthält nur die jüngste Seite. Ältere Aufträge kommen aus JSONL. */
export async function recoverUserPrompt(
  api: HubApi,
  sessionId: string,
  beforeSeq: number,
  cancelled: () => boolean,
): Promise<NormalizedEvent | null> {
  let after = 0;
  let prompt: NormalizedEvent | null = null;
  while (!cancelled() && after < beforeSeq) {
    const page = await api.events(sessionId, after, 2000);
    if (cancelled()) return null;
    for (const event of page) {
      if (event.seq >= beforeSeq) break;
      if (event.type === "user")
        prompt = {
          ...event,
          sessionId,
          payload: event.payload as Record<string, unknown>,
        };
    }
    const end = page.at(-1)?.seq;
    if (
      end === undefined ||
      end <= after ||
      end >= beforeSeq ||
      page.length < 2000
    )
      break;
    after = end;
  }
  return prompt;
}

export function useRecoveredPrompt(
  events: NormalizedEvent[],
  api: HubApi,
  sessionId: string,
) {
  const [recovered, setRecovered] = useState<NormalizedEvent | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const needed = events.length > 0 && lastUserPrompt(events) === null;
  useEffect(() => {
    if (!needed) return;
    let cancelled = false;
    setFailed(false);
    void recoverUserPrompt(
      api,
      sessionId,
      events[0]!.seq,
      () => cancelled,
    ).then(
      (prompt) => {
        if (!cancelled) setRecovered(prompt);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api, sessionId, needed, attempt]);
  return {
    prompt: needed ? recovered : null,
    failed: needed && failed,
    retry: () => setAttempt((value) => value + 1),
  };
}
