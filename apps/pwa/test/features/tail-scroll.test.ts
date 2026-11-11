import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readTailScroll, tailScrollKey, writeTailScroll } from "../../src/features/session/tail-scroll.ts";

const store = new Map<string, string>();

describe("tail-scroll (EPIC-P43 AC-P43-7)", () => {
  beforeEach(() => {
    store.clear();
    (globalThis as { localStorage?: Storage }).localStorage = {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, String(v)),
      removeItem: (k) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      get length() {
        return store.size;
      },
    } as Storage;
  });
  afterEach(() => store.clear());

  it("schreibt und liest die Position je Session und Reiter", () => {
    writeTailScroll("s1", "diff", 420);
    expect(store.get(tailScrollKey("s1", "diff"))).toBe("420");
    expect(readTailScroll("s1", "diff")).toBe(420);
    expect(readTailScroll("s1", "chat")).toBeNull();
    expect(readTailScroll("s2", "diff")).toBeNull();
  });

  it("löscht bei top ≤ 0 und verwirft kaputte Werte", () => {
    writeTailScroll("s1", "chat", 80);
    writeTailScroll("s1", "chat", 0);
    expect(readTailScroll("s1", "chat")).toBeNull();
    store.set(tailScrollKey("s1", "chat"), "nope");
    expect(readTailScroll("s1", "chat")).toBeNull();
  });
});
