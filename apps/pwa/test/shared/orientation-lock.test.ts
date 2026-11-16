import { describe, expect, it, vi } from "vitest";
import { lockOrientation } from "../../src/shared/orientation-lock.ts";

/** `screen.orientation` für einen Test austauschen und danach zurücksetzen. */
function withOrientation(orientation: unknown, run: () => Promise<void>) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "screen");
  Object.defineProperty(globalThis, "screen", { value: { orientation }, configurable: true, writable: true });
  return run().finally(() => {
    if (descriptor) Object.defineProperty(globalThis, "screen", descriptor);
    else delete (globalThis as { screen?: unknown }).screen;
  });
}

describe("Ausrichtung erzwingen (BUG-0186)", () => {
  it("gibt Querformat an, wenn das Fenster durchdarf", async () => {
    const lock = vi.fn(async () => undefined);
    await withOrientation({ lock, unlock: vi.fn() }, async () => {
      const res = await lockOrientation("landscape");
      expect(res).toEqual({ ok: true, detail: "Querformat erzwungen — das Fenster liegt jetzt quer.", how: "gelockt" });
      expect(lock).toHaveBeenCalledWith("landscape");
    });
  });

  it("entsperrt mit „any“ und sagt das auch so", async () => {
    const unlock = vi.fn();
    await withOrientation({ lock: vi.fn(async () => undefined), unlock }, async () => {
      const res = await lockOrientation("any");
      expect(res.how).toBe("entsperrt");
      expect(res.ok).toBe(true);
      expect(unlock).toHaveBeenCalled();
    });
  });

  it("nennt die Abweisung beim Namen — Gerät sperrt ist etwas anderes als API fehlt", async () => {
    await withOrientation({ lock: vi.fn(async () => {
      throw new DOMException("nope", "SecurityError");
    }) }, async () => {
      const res = await lockOrientation("landscape");
      expect(res.ok).toBe(false);
      expect(res.how).toBe("abgewiesen");
      expect(res.detail).toContain("SecurityError (Gerät sperrt)");
      expect(res.detail).toContain("Auto-Rotate");
    });
  });

  it("ohne API erfindet es kein Ergebnis", async () => {
    await withOrientation(undefined, async () => {
      const res = await lockOrientation("landscape");
      expect(res.how).toBe("keine-api");
      expect(res.ok).toBe(false);
    });
    await withOrientation({ }, async () => {
      const res = await lockOrientation("landscape");
      expect(res.how).toBe("keine-api");
    });
  });
});
