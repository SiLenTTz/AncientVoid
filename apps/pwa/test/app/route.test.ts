import { describe, expect, it } from "vitest";
import { codeHash, pageHash, parseAppHash, sessionHash } from "../../src/app/route.ts";

describe("session hash route (AC-P5-5)", () => {
  it("round-trips a session id", () => {
    const hash = sessionHash("abc/def");
    expect(parseAppHash(hash)).toEqual({ view: "tail", sessionId: "abc/def" });
  });

  it("treats an empty hash as the list", () => {
    expect(parseAppHash("")).toEqual({ view: "list", page: "dashboard" });
    expect(parseAppHash("#/settings")).toEqual({ view: "list", page: "dashboard" });
  });

  it("T8.1: every page round-trips through its hash", () => {
    for (const page of ["dashboard", "new", "settings", "approvals", "status", "discovery"] as const) expect(parseAppHash(pageHash(page))).toEqual({ view: "list", page });
    expect(pageHash("new")).toBe("#/neu");
  });

  it("T7.6: a code line round-trips, paths with slashes and special characters included", () => {
    const hash = codeHash("s1", "src/a b/ä.ts", 42, "evox2");
    expect(parseAppHash(hash)).toEqual({ view: "tail", hostId: "evox2", sessionId: "s1", code: { path: "src/a b/ä.ts", line: 42 } });
    expect(parseAppHash(codeHash("s1", "README.md", null))).toEqual({ view: "tail", sessionId: "s1", code: { path: "README.md", line: null } });
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

