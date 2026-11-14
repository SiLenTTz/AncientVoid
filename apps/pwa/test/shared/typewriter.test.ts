import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isLiveTs, queueStep, setTypewriterOn, TW_IMMEDIATE_LAG, typeStep, typewriterActive, typewriterOn } from "../../src/shared/typewriter.ts";

/** EPIC-P58 T58.2/T58.3: der reine Kern — Tempo, Queue, Gate, lokaler Speicher. */

const mem = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => mem.get(key) ?? null,
    setItem: (key: string, value: string) => void mem.set(key, value),
    removeItem: (key: string) => void mem.delete(key),
  },
});
let dataset: Record<string, string> = {};
vi.stubGlobal("document", { documentElement: { dataset } });
const reduced = (on: boolean) => vi.stubGlobal("matchMedia", () => ({ matches: on }));

beforeEach(() => {
  mem.clear();
  // afterEach entstubbt — beides gehört vor jeden Test neu gesetzt.
  vi.stubGlobal("document", { documentElement: { dataset } });
  for (const k of Object.keys(dataset)) delete dataset[k];
  reduced(false);
});
afterEach(() => vi.unstubAllGlobals());

describe("Speicher und Gate (T58.3, AC-P58-1/AC-P58-4)", () => {
  it("Standard ist an; ein gesetztes Aus gewinnt; ein gesetztes An bleibt über ein Neuladen", () => {
    expect(typewriterOn()).toBe(true);
    setTypewriterOn(false);
    expect(typewriterOn()).toBe(false);
    setTypewriterOn(true);
    expect(typewriterOn()).toBe(true);
  });

  it("Bewegung aus oder Reduce Motion schalten den Typwriter immer aus (AC-P47-6-Präzedenz: Hauptgate gewinnt)", () => {
    expect(typewriterActive()).toBe(true);
    setTypewriterOn(false);
    dataset.ctxMotion = "off";
    expect(typewriterActive()).toBe(false);
    setTypewriterOn(true);
    expect(typewriterActive()).toBe(false);
    dataset.ctxMotion = "on";
    expect(typewriterActive()).toBe(true);
    reduced(true);
    expect(typewriterActive()).toBe(false);
  });
});

describe("Tempo (T58.2, K2)", () => {
  it("grundet bei kleiner Menge, holt bei große auf, rastet ab der Tempo-Grenze sofort ein", () => {
    expect(typeStep(0, 0)).toBe(0);
    expect(typeStep(3, 10)).toBe(3 + 2); // Grundtempo
    expect(typeStep(0, 100)).toBe(Math.ceil(100 / 6)); // Aufholbereich
    expect(typeStep(0, TW_IMMEDIATE_LAG)).toBe(TW_IMMEDIATE_LAG); // Tempo-Grenze: sofort
    expect(typeStep(TW_IMMEDIATE_LAG - 100, TW_IMMEDIATE_LAG)).toBe(TW_IMMEDIATE_LAG - 100 + Math.ceil(100 / 6));
    expect(typeStep(99, 100)).toBe(100); // überschießt nie
  });
});

describe("Queue pro Zug (T58.2)", () => {
  it("nur das älteste Stück wird getippt, die anderen warten; wird es zu viel, rastet alles ein", () => {
    expect(queueStep(0, 10, 0, 3)).toBe(2);
    expect(queueStep(0, 40, 0, 3)).toBe(Math.ceil(40 / 6)); // Aufholbereich
    expect(queueStep(0, 40, 1, 3)).toBe(0);
    expect(queueStep(12, 40, 1, 3)).toBe(12); // Wartende rücken erst beim nächsten Takt nach
    expect(queueStep(0, 40, 0, 99)).toBe(40); // über der Grenze: alles sofort
    expect(queueStep(0, 40, 1, 99)).toBe(40);
  });
});

describe("Live-Erkennung (AC-P58-2)", () => {
  it("frische Ereignisse werden getippt, was schon da war nicht", () => {
    const now = Date.now();
    const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
    expect(isLiveTs(iso(500))).toBe(true);
    expect(isLiveTs(iso(2_500))).toBe(true);
    expect(isLiveTs(iso(5_000))).toBe(false);
    expect(isLiveTs("morgen")).toBe(false);
  });
});
