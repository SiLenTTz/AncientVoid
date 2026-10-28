/** Wartezeit vor dem n-ten resync für dieselbe Lücke: eine Lücke ist oft nur ein Event, das beim ersten Lesen
 * noch nicht auf der Platte stand — sofort, dann mit Abstand. Danach gibt der Client auf (kein Dauerfeuer, BUG-0075). */
export const RESYNC_BACKOFF_MS = [0, 250, 750, 2000, 5000] as const;

export function resyncDelayMs(attempt: number): number {
  return RESYNC_BACKOFF_MS[Math.min(attempt, RESYNC_BACKOFF_MS.length - 1)]!;
}

/** Pure WS-resync decision — testable without a browser WebSocket (T4.5-5). */
export function shouldResync(
  lastSeq: number,
  firstIncomingSeq: number | undefined,
  dropped: boolean,
  /** Wie oft für genau dieses `lastSeq` schon ein resync geschickt wurde. */
  attempts = 0,
): boolean {
  // Schließt kein resync die Lücke, hat der Hub nichts Besseres (Altdaten mit fehlender seq).
  if (attempts >= RESYNC_BACKOFF_MS.length) return false;
  if (dropped) return true;
  if (firstIncomingSeq === undefined) return false;
  return firstIncomingSeq > lastSeq + 1;
}

/** BUG-0023: the hub delivers at least once — a `hello` replay can overlap
 * with live pushes. Anything at or below `lastSeq` is already on screen. */
export function newEvents<T extends { seq: number }>(lastSeq: number, incoming: readonly T[]): T[] {
  return incoming.filter((event) => event.seq > lastSeq);
}
