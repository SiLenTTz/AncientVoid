/** Pure WS-resync decision — testable without a browser WebSocket (T4.5-5). */
export function shouldResync(
  lastSeq: number,
  firstIncomingSeq: number | undefined,
  dropped: boolean,
  /** Für genau dieses `lastSeq` wurde schon ein resync geschickt. */
  alreadyResynced = false,
): boolean {
  // Ein resync, der die Lücke nicht schließt, wird nicht wiederholt: der Hub
  // hat dann nichts Besseres (Altdaten mit fehlender seq) — sonst Endlosschleife.
  if (alreadyResynced) return false;
  if (dropped) return true;
  if (firstIncomingSeq === undefined) return false;
  return firstIncomingSeq > lastSeq + 1;
}

/** BUG-0023: the hub delivers at least once — a `hello` replay can overlap
 * with live pushes. Anything at or below `lastSeq` is already on screen. */
export function newEvents<T extends { seq: number }>(lastSeq: number, incoming: readonly T[]): T[] {
  return incoming.filter((event) => event.seq > lastSeq);
}
