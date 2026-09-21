/** Pure WS-resync decision — testable without a browser WebSocket (T4.5-5). */
export function shouldResync(
  lastSeq: number,
  firstIncomingSeq: number | undefined,
  dropped: boolean,
): boolean {
  if (dropped) return true;
  if (firstIncomingSeq === undefined) return false;
  return firstIncomingSeq > lastSeq + 1;
}
