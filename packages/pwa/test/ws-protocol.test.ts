import { describe, expect, it } from "vitest";
import { shouldResync } from "../src/ws-protocol.ts";

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
