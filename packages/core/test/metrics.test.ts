import { describe, expect, it } from "vitest";
import { InMemoryMetrics } from "../src/metrics.ts";

describe("InMemoryMetrics (T4.5-3)", () => {
  it("counts increments and overwrites gauges", () => {
    const metrics = new InMemoryMetrics();
    metrics.inc("events_appended");
    metrics.inc("events_appended", 4);
    metrics.gauge("sessions_live", 2);
    metrics.gauge("sessions_live", 3);
    const snap = metrics.snapshot();
    expect(snap.counters.events_appended).toBe(5);
    expect(snap.gauges.sessions_live).toBe(3);
    expect(typeof snap.ts).toBe("string");
  });

  it("starts empty after a fresh instance — restart semantics, not K7 state", () => {
    const first = new InMemoryMetrics();
    first.inc("ws_connects");
    const second = new InMemoryMetrics();
    expect(second.snapshot().counters).toEqual({});
  });
});
