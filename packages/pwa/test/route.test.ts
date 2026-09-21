import { describe, expect, it } from "vitest";
import { parseAppHash, sessionHash } from "../src/route.ts";

describe("session hash route (AC-P5-5)", () => {
  it("round-trips a session id", () => {
    const hash = sessionHash("abc/def");
    expect(parseAppHash(hash)).toEqual({ view: "tail", sessionId: "abc/def" });
  });

  it("treats an empty hash as the list", () => {
    expect(parseAppHash("")).toEqual({ view: "list" });
    expect(parseAppHash("#/settings")).toEqual({ view: "list" });
  });
});
