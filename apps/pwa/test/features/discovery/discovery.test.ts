import { describe, expect, it } from "vitest";
import { discoveryHeading, observedAgo } from "../../../src/features/discovery/Discovery.tsx";

describe("observedAgo (T5.3: age of an observation)", () => {
  const now = Date.parse("2026-09-23T12:00:00Z");
  it("names seconds, minutes, hours and days", () => {
    expect(observedAgo("2026-09-23T11:59:30Z", now)).toBe("gerade eben");
    expect(observedAgo("2026-09-23T11:55:00Z", now)).toBe("vor 5 min");
    expect(observedAgo("2026-09-23T09:00:00Z", now)).toBe("vor 3 h");
    expect(observedAgo("2026-09-21T12:00:00Z", now)).toBe("vor 2 d");
  });
  it("never shows a negative age", () => {
    expect(observedAgo("2026-09-23T12:05:00Z", now)).toBe("gerade eben");
  });
});

describe("discoveryHeading (ADR-0040)", () => {
  it("zeigt den Titel, sonst eine als solche erkennbare Kurz-ID statt einer rohen ID", () => {
    expect(discoveryHeading({ title: "Login umbauen", nativeSessionId: "738108e8-08e7", hubSessionId: null })).toEqual({ text: "Login umbauen", untitled: false });
    expect(discoveryHeading({ title: null, nativeSessionId: "738108e8-08e7-463f", hubSessionId: null })).toEqual({ text: "Ohne Titel · 738108e8", untitled: true });
    expect(discoveryHeading({ title: null, nativeSessionId: null, hubSessionId: null })).toEqual({ text: "Ohne Titel", untitled: true });
  });
});
