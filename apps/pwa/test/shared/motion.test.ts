import { afterEach, describe, expect, it, vi } from "vitest";
import { countStep, motionAllowed, wander } from "../../src/shared/motion.ts";

function fakeDocument(ctxMotion: string | undefined, startViewTransition?: (update: () => void) => unknown) {
  vi.stubGlobal("document", { documentElement: { dataset: ctxMotion === undefined ? {} : { ctxMotion } }, ...(startViewTransition ? { startViewTransition } : {}) });
}
const reduced = (on: boolean) => vi.stubGlobal("matchMedia", () => ({ matches: on }));

afterEach(() => vi.unstubAllGlobals());

describe("motionAllowed (EPIC-P43, AC-P43-5)", () => {
  it("an im Normalfall, aus bei Schalter oder Systemvorgabe", () => {
    fakeDocument("on");
    reduced(false);
    expect(motionAllowed()).toBe(true);
    fakeDocument("off");
    expect(motionAllowed()).toBe(false);
    fakeDocument("on");
    reduced(true);
    expect(motionAllowed()).toBe(false);
  });
});

describe("wander", () => {
  it("nutzt View Transitions, wenn Bewegung erlaubt ist", () => {
    const start = vi.fn((update: () => void) => update());
    fakeDocument("on", start);
    reduced(false);
    const update = vi.fn();
    wander(update);
    expect(start).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledOnce();
  });

  it("ohne Bewegung oder ohne Unterstützung läuft die Änderung sofort — gleicher Zustand, kein Weg", () => {
    const start = vi.fn();
    fakeDocument("off", start);
    reduced(false);
    const update = vi.fn();
    wander(update);
    expect(start).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledOnce();
    fakeDocument("on");
    wander(update);
    expect(update).toHaveBeenCalledTimes(2);
  });
});

describe("countStep (Zählen)", () => {
  it("nähert sich dem Ziel, überschießt nie und rastet ein", () => {
    let shown = 0;
    const seen: number[] = [];
    for (let i = 0; i < 200 && shown !== 1000; i++) {
      shown = countStep(shown, 1000, 16);
      seen.push(shown);
    }
    expect(shown).toBe(1000);
    for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThan(seen[i - 1]!);
    expect(Math.max(...seen)).toBe(1000);
  });

  it("zählt auch abwärts, steht ohne vergangene Zeit still und springt bei unbrauchbaren Werten direkt", () => {
    expect(countStep(100, 0, 120)).toBeCloseTo(50, 5);
    expect(countStep(10, 500, 0)).toBe(10);
    expect(countStep(Number.NaN, 42, 16)).toBe(42);
    expect(countStep(41.8, 42, 16)).toBe(42);
  });
});
