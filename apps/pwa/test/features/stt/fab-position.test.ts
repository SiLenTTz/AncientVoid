import { describe, expect, it } from "vitest";
import { clampFabPos, defaultFabPos, FAB_SIZE, fabBreakpoint } from "../../../src/features/stt/fab-position.ts";

describe("fab-position", () => {
  it("mappt Breakpoints", () => {
    expect(fabBreakpoint(390)).toBe("phone");
    expect(fabBreakpoint(800)).toBe("tablet");
    expect(fabBreakpoint(1400)).toBe("pc");
  });

  it("Default: Handy unten rechts, PC mittig", () => {
    const phone = defaultFabPos("phone", 390, 800);
    expect(phone.x).toBeGreaterThan(300);
    expect(phone.y).toBeGreaterThan(600);
    const pc = defaultFabPos("pc", 1400, 900);
    expect(pc.x).toBeCloseTo((1400 - FAB_SIZE) / 2, 0);
    expect(pc.y).toBeCloseTo((900 - FAB_SIZE) / 2, 0);
  });

  it("clamp hält im Viewport", () => {
    expect(clampFabPos({ x: -10, y: 9999 }, 400, 700)).toEqual({ x: 0, y: 700 - FAB_SIZE });
  });
});
