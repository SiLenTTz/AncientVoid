import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchEventBlob } from "../../src/features/session/event-blobs.ts";
import type { HubApi } from "../../src/shared/api.ts";
import type { NormalizedEvent } from "../../src/shared/ws.ts";
import { hostApi } from "../../src/shared/api.ts";

afterEach(() => vi.unstubAllGlobals());

const event: NormalizedEvent = { seq: 1, type: "tool_use", summary: "read", payload: { truncated: true }, sessionId: "s", ts: "2026-11-13T00:00:00Z", blobRef: "sha256:abc" };
const apiWith = (eventBlob: unknown) => ({ eventBlob }) as HubApi;

describe("Blob-Zugriff für Chat und Verlauf", () => {
  it("lädt Fleet-Blobs vom richtigen Host und hält die Authentifizierung im Header", async () => {
    vi.stubGlobal("localStorage", { getItem: () => "unit-test" });
    const fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => "Details" });
    vi.stubGlobal("fetch", fetch);
    await expect(hostApi("remote-host").eventBlob("session-a", "sha256:abc")).resolves.toBe("Details");
    expect(fetch).toHaveBeenCalledWith("/api/hosts/remote-host/sessions/session-a/blobs/abc", { headers: { authorization: "Bearer unit-test" } });
  });
  it("teilt parallele Zugriffe und trennt Hosts und Sessions", async () => {
    const load = vi.fn().mockResolvedValue("{}");
    const api = apiWith(load);
    await Promise.all([fetchEventBlob(api, event), fetchEventBlob(api, event)]);
    expect(load).toHaveBeenCalledTimes(1);
    await fetchEventBlob(api, { ...event, sessionId: "other" });
    expect(load).toHaveBeenCalledTimes(2);
    const other = vi.fn().mockResolvedValue("{}");
    await fetchEventBlob(apiWith(other), event);
    expect(other).toHaveBeenCalledTimes(1);
  });
  it("erlaubt Wiederholen nach einem Ladefehler", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue("{}");
    const api = apiWith(load);
    await expect(fetchEventBlob(api, event)).rejects.toThrow("offline");
    await expect(fetchEventBlob(api, event)).resolves.toBe("{}");
    expect(load).toHaveBeenCalledTimes(2);
  });
});
