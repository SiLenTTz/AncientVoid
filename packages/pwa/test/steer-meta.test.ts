import { afterEach, describe, expect, it, vi } from "vitest";
import { hubApi, steerRejectText } from "../src/api.ts";

describe("steer meta from the PWA (AC-P5-4)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends a stable client id and the caller's input id", async () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    await hubApi.steer("s1", { kind: "prompt", text: "a" }, "in-1");
    await hubApi.steer("s1", { kind: "prompt", text: "a" }, "in-1");
    expect(bodies[0]).toMatchObject({ kind: "prompt", text: "a", inputId: "in-1" });
    expect(typeof bodies[0]?.clientId).toBe("string");
    expect(bodies[1]?.clientId).toBe(bodies[0]?.clientId);
  });

  it("explains a lease or revision conflict instead of the raw code", () => {
    expect(steerRejectText("writer lease held")).toMatch(/anderes Gerät/);
    expect(steerRejectText("revision conflict")).toMatch(/erneut senden/);
    expect(steerRejectText("no thread")).toBe("no thread");
  });
});
