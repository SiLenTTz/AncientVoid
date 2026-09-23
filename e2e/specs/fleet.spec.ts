import { test, expect } from "../support/fixtures.ts";
import { TestHub } from "../support/hub.ts";

test.describe("Flotte (EPIC-P6)", () => {
  test.use({ hubOptions: { hostId: "omarchy" } });

  test("T6.1-Spike: zwei echte Hubs melden sich mit eigener Host-ID und Protokoll", async ({ hub }) => {
    const peer = await TestHub.start({ hostId: "silenttz-server" });
    try {
      const [a, b] = await Promise.all([hub.api<{ hostId: string; protocolVersion: number }>("/api/fleet/hello"), peer.api<{ hostId: string; protocolVersion: number }>("/api/fleet/hello")]);
      expect(a.body.hostId).toBe("omarchy");
      expect(b.body.hostId).toBe("silenttz-server");
      expect(a.body.protocolVersion).toBe(b.body.protocolVersion);
      const id = await peer.createSession({ adapter: "dummy" });
      expect((await peer.api<{ hostId: string }>(`/api/sessions/${id}`)).body.hostId).toBe("silenttz-server");
    } finally {
      await peer.stop();
    }
  });
});
