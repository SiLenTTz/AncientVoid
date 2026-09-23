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

describe("host-qualified session links (EPIC-P6)", () => {
  it("round-trips host and session", () => {
    const hash = sessionHash("abc", "silenttz-server");
    expect(hash).toBe("#/hosts/silenttz-server/sessions/abc");
    expect(parseAppHash(hash)).toEqual({ view: "tail", hostId: "silenttz-server", sessionId: "abc" });
  });

  it("keeps old links without a host working", () => {
    expect(parseAppHash("#/sessions/abc")).toEqual({ view: "tail", sessionId: "abc" });
  });
});
