import { describe, expect, it } from "vitest";
import { observedAgo } from "../../../src/features/discovery/Discovery.tsx";

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
