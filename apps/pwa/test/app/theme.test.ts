import { beforeEach, describe, expect, it } from "vitest";

const mem = new Map<string, string>();
const dataset: Record<string, string> = {};

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => mem.get(key) ?? null,
    setItem: (key: string, value: string) => {
      mem.set(key, value);
    },
    removeItem: (key: string) => {
      mem.delete(key);
    },
    clear: () => mem.clear(),
  },
});
Object.defineProperty(globalThis, "document", {
  configurable: true,
  value: { documentElement: { dataset } },
});

const { getTheme, applyTheme } = await import("../../src/app/theme.ts");

describe("theme (T4.5-5)", () => {
  beforeEach(() => {
    mem.clear();
    for (const key of Object.keys(dataset)) delete dataset[key];
  });

  it("defaults to dark when nothing is stored", () => {
    expect(getTheme()).toBe("dark");
  });

  it("persists light and writes data-theme", () => {
    applyTheme("light");
    expect(getTheme()).toBe("light");
    expect(dataset.theme).toBe("light");
    expect(mem.get("ancientvoid.theme")).toBe("light");
  });
});
