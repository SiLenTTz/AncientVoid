import { describe, expect, it, vi } from "vitest";
import { memoryCheck, watchMemory } from "../../../src/modules/observability/memory.ts";

const MB = 1024 * 1024;
const limit = 1000 * MB;

describe("memoryCheck (Speicher-Wächter)", () => {
  it("unter 60 % des Heap-Limits ist alles in Ordnung", () => {
    const c = memoryCheck({ heapUsed: 300 * MB, rss: 400 * MB }, limit);
    expect(c).toMatchObject({ ok: true, level: "ok", heapUsedMb: 300, heapLimitMb: 1000, rssMb: 400 });
    expect(c.detail).toBeUndefined();
  });
  it("ab 60 % warnt, ab 80 % ist es kritisch — mit Klartext", () => {
    expect(memoryCheck({ heapUsed: 650 * MB, rss: 0 }, limit)).toMatchObject({ ok: false, level: "warn", detail: "Heap bei 65 % des Limits (650 von 1000 MB)" });
    expect(memoryCheck({ heapUsed: 900 * MB, rss: 0 }, limit)).toMatchObject({ ok: false, level: "critical" });
  });
});

describe("watchMemory", () => {
  it("meldet nur Stufenwechsel, nicht jeden Tick", () => {
    vi.useFakeTimers();
    try {
      const used = [100, 700, 710, 720, 950, 100];
      let i = 0;
      const seen: string[] = [];
      const stop = watchMemory((c, prev) => seen.push(`${prev}>${c.level}`), {
        intervalMs: 1000,
        sample: () => memoryCheck({ heapUsed: used[i++]! * MB, rss: 0 }, limit),
      });
      vi.advanceTimersByTime(6000);
      stop();
      expect(seen).toEqual(["ok>warn", "warn>critical", "critical>ok"]);
    } finally {
      vi.useRealTimers();
    }
  });
});
