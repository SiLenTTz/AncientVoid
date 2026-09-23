import { afterEach, describe, expect, it, vi } from "vitest";
import { connectTail } from "../../src/shared/ws.ts";

class FakeSocket {
  static last: FakeSocket | undefined;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((msg: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor() {
    FakeSocket.last = this;
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {}
  push(events: number[], extra: Record<string, unknown> = {}) {
    const batch = events.map((seq) => ({ seq, ts: "", sessionId: "s", type: "system", summary: `#${seq}`, payload: {}, blobRef: null }));
    this.onmessage?.({ data: JSON.stringify({ type: "events", events: batch, highWater: events.at(-1), dropped: false, ...extra }) });
  }
}

describe("connectTail delivers each event once (BUG-0023)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("drops the overlap of a resync or hello replay", () => {
    vi.stubGlobal("WebSocket", FakeSocket);
    const seen: number[] = [];
    const tail = connectTail({ url: "http://hub", token: "t", sessionId: "s", onEvents: (e) => seen.push(...e.map((x) => x.seq)), onState: () => undefined });
    FakeSocket.last!.onopen?.();
    FakeSocket.last!.push([1, 2, 3, 4]);
    FakeSocket.last!.push([3, 4, 5]);
    FakeSocket.last!.push([2]);
    expect(seen).toEqual([1, 2, 3, 4, 5]);
    tail.close();
  });

  it("BUG-0026: takes a baseline page as its start instead of resyncing", () => {
    vi.stubGlobal("WebSocket", FakeSocket);
    const seen: number[] = [];
    const tail = connectTail({ url: "http://hub", token: "t", sessionId: "s", onEvents: (e) => seen.push(...e.map((x) => x.seq)), onState: () => undefined });
    FakeSocket.last!.onopen?.();
    FakeSocket.last!.push([401, 402, 403], { baseline: true });
    FakeSocket.last!.push([404]);
    expect(seen).toEqual([401, 402, 403, 404]);
    expect(FakeSocket.last!.sent.some((m) => m.includes("resync"))).toBe(false);
    tail.close();
  });
});
