import { describe, expect, it } from "vitest";

/**
 * K10 (BUG, gemeldet 2026-11-12): „Daten vom … (offline)" blieb dauerhaft stehen.
 * Ursache: der Badge verschwand nur beim „online"-Event des Browsers — ist das Netz
 * an, der Hub aber unreachable, feuert das nie. Seit dem Fix sagt eine erfolgreiche
 * Antwort ohne Cache-Marker (ancientvoid:fresh-data) der UI ebenfalls: Daten sind live.
 */
const dispatched: Event[] = [];
Object.defineProperty(globalThis, "document", {
  configurable: true,
  value: { dispatchEvent: (e: Event) => (dispatched.push(e), true) },
});

const { announceDataFreshness } = await import("../../src/shared/api.ts");

const res = (status: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({}), { status, headers });

describe("announceDataFreshness (Offline-Badge)", () => {
  it("Browser-Cache-Antwort meldet stale-data mit dem gespeicherten Zeitpunkt", () => {
    dispatched.length = 0;
    announceDataFreshness(res(200, { "X-AncientVoid-Cached-At": "2026-11-12T07:22:48.000Z" }));
    expect(dispatched.map((e) => e.type)).toEqual(["ancientvoid:stale-data"]);
    expect((dispatched[0] as CustomEvent<string>).detail).toBe("2026-11-12T07:22:48.000Z");
  });

  it("erfolgreiche Live-Antwort meldet fresh-data — der Badge muss verschwinden", () => {
    dispatched.length = 0;
    announceDataFreshness(res(200));
    expect(dispatched.map((e) => e.type)).toEqual(["ancientvoid:fresh-data"]);
  });

  it("fehlgeschlagene Antwort (offline, kein Cache) meldet gar nichts", () => {
    dispatched.length = 0;
    announceDataFreshness(res(503));
    expect(dispatched).toEqual([]);
  });
});
