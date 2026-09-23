import { describe, expect, it } from "vitest";
import { newEvents, shouldResync } from "../src/ws-protocol.ts";

describe("shouldResync (T4.5-5)", () => {
  it("resyncs when the server flagged a drop", () => {
    expect(shouldResync(10, 11, true)).toBe(true);
  });

  it("resyncs when the first incoming seq skips ahead", () => {
    expect(shouldResync(10, 12, false)).toBe(true);
  });

  it("does not resync for a contiguous next seq", () => {
    expect(shouldResync(10, 11, false)).toBe(false);
  });

  it("does not resync on an empty batch without drop", () => {
    expect(shouldResync(10, undefined, false)).toBe(false);
  });
});

describe("newEvents (BUG-0023)", () => {
  const ev = (seq: number) => ({ seq });

  it("drops events the client already has", () => {
    expect(newEvents(3, [ev(2), ev(3), ev(4), ev(5)]).map((e) => e.seq)).toEqual([4, 5]);
  });

  it("drops a batch that is entirely a repeat", () => {
    expect(newEvents(5, [ev(1), ev(2)])).toEqual([]);
  });

  it("keeps a fresh batch as is", () => {
    expect(newEvents(0, [ev(1), ev(2)]).map((e) => e.seq)).toEqual([1, 2]);
  });
});
