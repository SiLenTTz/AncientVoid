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

  test("T6.2: Host per Einladungscode verbinden, anzeigen und wieder entfernen @desktop", async ({ app }) => {
    const peer = await TestHub.start({ hostId: "silenttz-server" });
    try {
      await app.getByRole("button", { name: "Einstellungen" }).click();
      await expect(app.locator(".fleet-self")).toHaveText("omarchy");
      const invite = await peer.api<{ code: string }>("/api/fleet/invites", { body: {} });
      await app.getByLabel("Host hinzufügen — Adresse").fill(peer.origin);
      await app.getByLabel("Einladungscode vom anderen Hub").fill(invite.body.code.toLowerCase());
      await app.getByRole("button", { name: "Host verbinden" }).click();
      await expect(app.locator(".fleet-message.ok")).toHaveText("Verbunden mit silenttz-server.");
      await expect(app.locator(".fleet-peer")).toContainText("silenttz-server");
      await expect(app.locator(".fleet-peer")).toContainText(peer.origin);

      await app.getByLabel("Einladungscode vom anderen Hub").fill(invite.body.code);
      await app.getByLabel("Host hinzufügen — Adresse").fill(peer.origin);
      await app.getByRole("button", { name: "Host verbinden" }).click();
      await expect(app.locator(".fleet-message.reply-error")).toContainText("code already used");

      await app.locator(".fleet-peer").getByRole("button", { name: "Entfernen" }).click();
      await app.getByRole("button", { name: "Wirklich entfernen" }).click();
      await expect(app.locator(".fleet-peer")).toHaveCount(0);
    } finally {
      await peer.stop();
    }
  });

  test("T6.2: auf dem anderen Hub einen Einladungscode erzeugen", async ({ app }) => {
    await app.getByRole("button", { name: "Einstellungen" }).click();
    await app.getByRole("button", { name: "Einladungscode erzeugen" }).click();
    await expect(app.locator(".fleet-invite code")).toHaveText(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    await expect(app.locator(".fleet-invite")).toContainText("einmalig");
  });
});
