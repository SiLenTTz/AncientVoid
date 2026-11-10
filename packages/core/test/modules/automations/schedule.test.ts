import { describe, expect, it } from "vitest";
import { expandCronField, nextOccurrences, wallToUtcInstants } from "../../../src/modules/automations/schedule.ts";

// Anker von Hand verifiziert: Europe/Berlin Winter +01:00, Sommer +02:00;
// DST-Wechsel 2026: 29.03. (Lücke 02:30) und 25.10. (Falte 02:30).
const berlin = "Europe/Berlin";
const newYork = "America/New_York";

describe("schedule occurrence engine (T41.2 / ADR-0064)", () => {
  it("daily preset respects the timezone offset in winter and summer", () => {
    const daily = { kind: "preset" as const, preset: "daily" as const, localTime: "12:00", timezone: berlin };
    expect(nextOccurrences(daily, "2026-01-05T00:00:00.000Z", 2)).toEqual([
      { utc: "2026-01-05T11:00:00.000Z", local: "2026-01-05T12:00+01:00" },
      { utc: "2026-01-06T11:00:00.000Z", local: "2026-01-06T12:00+01:00" },
    ]);
    expect(nextOccurrences(daily, "2026-07-01T00:00:00.000Z", 1)).toEqual([
      { utc: "2026-07-01T10:00:00.000Z", local: "2026-07-01T12:00+02:00" },
    ]);
    const ny = { kind: "preset" as const, preset: "daily" as const, localTime: "12:00", timezone: newYork };
    expect(nextOccurrences(ny, "2026-01-05T00:00:00.000Z", 1)).toEqual([
      { utc: "2026-01-05T17:00:00.000Z", local: "2026-01-05T12:00-05:00" },
    ]);
  });

  it("AC-P41-2: the DST gap is skipped, the fold fires exactly once (the earlier instant)", () => {
    const daily = { kind: "preset" as const, preset: "daily" as const, localTime: "02:30", timezone: berlin };
    // 28.03. normal (+01), 29.03. Lücke → übersprungen, 30.03. schon Sommer (+02).
    expect(nextOccurrences(daily, "2026-03-28T00:00:00.000Z", 2)).toEqual([
      { utc: "2026-03-28T01:30:00.000Z", local: "2026-03-28T02:30+01:00" },
      { utc: "2026-03-30T00:30:00.000Z", local: "2026-03-30T02:30+02:00" },
    ]);
    // Herbst: 24.10. noch Sommer, 25.10. Falte → genau einmal, der frühere Moment.
    expect(nextOccurrences(daily, "2026-10-24T00:00:00.000Z", 3)).toEqual([
      { utc: "2026-10-24T00:30:00.000Z", local: "2026-10-24T02:30+02:00" },
      { utc: "2026-10-25T00:30:00.000Z", local: "2026-10-25T02:30+02:00" },
      { utc: "2026-10-26T01:30:00.000Z", local: "2026-10-26T02:30+01:00" },
    ]);
  });

  it("wallToUtcInstants reports gap (none) and fold (two) explicitly", () => {
    expect(wallToUtcInstants(Date.UTC(2026, 2, 29, 2, 30), berlin)).toEqual([]);
    expect(wallToUtcInstants(Date.UTC(2026, 9, 25, 2, 30), berlin)).toEqual([
      Date.parse("2026-10-25T00:30:00.000Z"),
      Date.parse("2026-10-25T01:30:00.000Z"),
    ]);
    expect(wallToUtcInstants(Date.UTC(2026, 0, 15, 12, 0), berlin)).toEqual([Date.parse("2026-01-15T11:00:00.000Z")]);
  });

  it("Vixie rule: dom AND dow restricted means OR; impossible dates never fire", () => {
    const orRule = { kind: "cron" as const, cron: "0 12 13 * 5", timezone: berlin };
    expect(nextOccurrences(orRule, "2026-11-12T00:00:00.000Z", 2)).toEqual([
      { utc: "2026-11-13T11:00:00.000Z", local: "2026-11-13T12:00+01:00" },
      { utc: "2026-11-20T11:00:00.000Z", local: "2026-11-20T12:00+01:00" },
    ]);
    expect(nextOccurrences({ kind: "cron" as const, cron: "0 0 30 2 *", timezone: berlin }, "2026-01-01T00:00:00.000Z", 3)).toEqual([]);
  });

  it("presets hourly/weekly/weekday land on the expected local times", () => {
    expect(nextOccurrences({ kind: "preset" as const, preset: "hourly" as const, timezone: berlin }, "2026-11-12T10:30:00.000Z", 2)).toEqual([
      { utc: "2026-11-12T11:00:00.000Z", local: "2026-11-12T12:00+01:00" },
      { utc: "2026-11-12T12:00:00.000Z", local: "2026-11-12T13:00+01:00" },
    ]);
    expect(nextOccurrences({ kind: "preset" as const, preset: "weekly" as const, localTime: "06:00", weekdays: [2], timezone: berlin }, "2026-11-12T00:00:00.000Z", 1)).toEqual([
      { utc: "2026-11-17T05:00:00.000Z", local: "2026-11-17T06:00+01:00" },
    ]);
    expect(nextOccurrences({ kind: "preset" as const, preset: "weekday" as const, localTime: "08:00", timezone: berlin }, "2026-11-13T08:00:00.000Z", 1)).toEqual([
      // Freitag 08:00 Lokalzeit (07:00Z) ist schon vorbei — der nächste Werktag ist Montag.
      { utc: "2026-11-16T07:00:00.000Z", local: "2026-11-16T08:00+01:00" },
    ]);
  });

  it("expands the limited field subset and rejects what it must not accept", () => {
    expect(expandCronField("10-20/5", 0, 59)).toEqual([10, 15, 20]);
    expect(expandCronField("*/0", 0, 59)).toBeNull();
    expect(expandCronField("5-3", 0, 59)).toBeNull();
    expect(expandCronField("7", 0, 6)).toBeNull();
    expect(expandCronField("MON", 0, 6)).toBeNull();
  });

  it("dense schedules stay deterministic within the preview horizon (Oversize)", () => {
    const everyMinute = nextOccurrences({ kind: "cron" as const, cron: "* * * * *", timezone: berlin }, "2026-01-05T10:00:00.000Z", 10);
    expect(everyMinute).toHaveLength(10);
    expect(everyMinute[0]!.utc).toBe("2026-01-05T10:01:00.000Z");
    expect(everyMinute[9]!.utc).toBe("2026-01-05T10:10:00.000Z");
  });
});
