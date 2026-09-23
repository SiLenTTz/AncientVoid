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

  async function pair(home: TestHub, peer: TestHub): Promise<void> {
    const invite = await peer.api<{ code: string }>("/api/fleet/invites", { body: {} });
    const res = await home.api("/api/fleet/peers", { body: { url: peer.origin, code: invite.body.code } });
    expect(res.status).toBe(201);
  }

  test("T6.3/T6.4: beide Hosts in einer Übersicht, Aktionen landen beim richtigen Host @desktop", async ({ app, hub }) => {
    const peer = await TestHub.start({ hostId: "silenttz-server" });
    try {
      await pair(hub, peer);
      const local = await hub.createSession({ adapter: "opencode", prompt: "Lokal am PC" });
      const remote = await peer.createSession({ adapter: "opencode", prompt: "Auf dem Server" });
      await peer.until(async () => (await peer.api<{ status: string }>(`/api/sessions/${remote}`)).body.status === "idle", "remote idle");

      await app.reload();
      await expect(app.locator(".host-chip").filter({ hasText: "omarchy" })).toContainText("verbunden");
      await expect(app.locator(".host-chip").filter({ hasText: "silenttz-server" })).toContainText("verbunden");
      await expect(app.locator(".project-tile-header").filter({ hasText: "silenttz-server · alpha" })).toBeVisible();
      await expect(app.locator(".project-tile-header").filter({ hasText: "omarchy · alpha" })).toBeVisible();

      await app.locator(".project-tile").filter({ hasText: "silenttz-server · alpha" }).locator(".session-open").click();
      await expect(app).toHaveURL(new RegExp(`#/hosts/silenttz-server/sessions/${remote}`));
      await app.getByRole("button", { name: "Chat" }).click();
      await expect(app.getByText(/Antwort auf: Auf dem Server/)).toBeVisible();
      await app.getByPlaceholder("Antworten…").fill("Vom Handy an den Server");
      await app.getByRole("button", { name: "Senden" }).click();
      await expect(app.getByText(/Antwort auf: Vom Handy an den Server .*\(fortgesetzt\)|Antwort auf: Vom Handy an den Server/)).toBeVisible();
      const remoteEvents = await peer.events(remote);
      expect(remoteEvents.some((e) => e.type === "user" && e.payload.text === "Vom Handy an den Server")).toBe(true);
      const localEvents = await hub.events(local);
      expect(localEvents.some((e) => e.payload.text === "Vom Handy an den Server")).toBe(false);
    } finally {
      await peer.stop();
    }
  });

  test("T6.3: neue Session auf dem gewählten Host starten", async ({ app, hub }) => {
    const peer = await TestHub.start({ hostId: "silenttz-server" });
    try {
      await pair(hub, peer);
      await app.reload();
      await app.getByRole("button", { name: "Neue Session" }).click();
      await app.getByLabel("Host").selectOption("silenttz-server");
      await app.getByLabel("Adapter").selectOption("opencode");
      await expect(app.getByLabel("Projekt")).toContainText("alpha (main)");
      await app.getByPlaceholder("Refactore den Auth-Flow…").fill("Auf dem Server starten");
      await app.getByRole("button", { name: "Starten" }).click();
      await expect(app).toHaveURL(/#\/hosts\/silenttz-server\/sessions\//);
      const id = decodeURIComponent(app.url().split("/sessions/")[1]!);
      expect((await peer.api(`/api/sessions/${id}`)).status).toBe(200);
      expect((await hub.api(`/api/sessions/${id}`)).status).toBe(404);
    } finally {
      await peer.stop();
    }
  });

  test("T6.3/AC-P6-3: ein Host fällt aus — die anderen bleiben bedienbar, sein Stand bleibt sichtbar", async ({ app, hub }) => {
    const peer = await TestHub.start({ hostId: "silenttz-server" });
    try {
      await pair(hub, peer);
      await peer.createSession({ adapter: "dummy" });
      const local = await hub.createSession({ adapter: "opencode", prompt: "Lokal" });
      await app.reload();
      await expect(app.locator(".host-chip").filter({ hasText: "silenttz-server" })).toContainText("verbunden");
      await peer.kill("SIGKILL");
      await expect(app.locator(".host-chip").filter({ hasText: "silenttz-server" })).toContainText(/veraltet · Stand \d\d:\d\d/, { timeout: 15_000 });
      await expect(app.locator(".project-tile-header").filter({ hasText: "silenttz-server · alpha" })).toBeVisible();

      await app.locator(".project-tile").filter({ hasText: "omarchy · alpha" }).locator(".session-open").click();
      await app.getByRole("button", { name: "Chat" }).click();
      await expect(app.getByText(/Antwort auf: Lokal/)).toBeVisible();
      await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${local}`)).body.status === "idle", "idle");
      await app.getByPlaceholder("Antworten…").fill("Trotzdem weiter");
      await app.getByRole("button", { name: "Senden" }).click();
      await expect(app.getByText(/Antwort auf: Trotzdem weiter/)).toBeVisible();
    } finally {
      await peer.stop();
    }
  });

  test("T6.2/AC-P6-4: widerrufene Kopplung wird in der Übersicht benannt", async ({ app, hub }) => {
    const peer = await TestHub.start({ hostId: "silenttz-server" });
    try {
      await pair(hub, peer);
      await app.reload();
      await expect(app.locator(".host-chip").filter({ hasText: "silenttz-server" })).toContainText("verbunden");
      const { execFileSync } = await import("node:child_process");
      execFileSync(process.execPath, ["packages/hubctl/src/cli.ts", "token", "revoke", "fleet:omarchy", "--db", `${peer.dataDir}/hub.db`]);
      await expect(app.locator(".host-chip").filter({ hasText: "silenttz-server" })).toContainText("Zugriff entzogen", { timeout: 15_000 });
    } finally {
      await peer.stop();
    }
  });

  test("T6.6: Meldungen, Befehle und Übernehmen gehören zum Host der Session", async ({ app, hub }) => {
    const peer = await TestHub.start({ hostId: "silenttz-server" });
    try {
      await pair(hub, peer);
      // The bell has taken its first look at the server: from now on its
      // notifications arrive as toasts.
      const firstLook = app.waitForResponse(/\/api\/hosts\/silenttz-server\/notifications/);
      await app.reload();
      await firstLook;
      const remote = await peer.createSession({ adapter: "opencode", prompt: "Lege eine DATEI an" });

      const toast = app.locator(".toast.success").filter({ hasText: "silenttz-server · alpha · Zug fertig" });
      await expect(toast).toBeVisible({ timeout: 15_000 });
      await toast.locator(".toast-body").click();
      await expect(app).toHaveURL(new RegExp(`#/hosts/silenttz-server/sessions/${remote}`));

      await app.getByRole("button", { name: "Bericht" }).click();
      await expect(app.locator(".continue-open")).toHaveText(/^ssh -t silenttz-server 'cd .* && opencode --session ses_e2e_\w+'$/);
      await expect(app.locator(".worktree-card")).toContainText("auf silenttz-server");
      await expect(app.locator(".worktree-open")).toHaveText(/^code --remote ssh-remote\+silenttz-server /);

      await app.getByRole("button", { name: "Ins Projekt übernehmen" }).click();
      await app.getByRole("button", { name: "Jetzt übernehmen" }).click();
      await expect(app.locator(".apply-result.ok")).toContainText("nach main");
      const { existsSync } = await import("node:fs");
      expect(existsSync(`${peer.alpha}/e2e-change.txt`), "applied on the session's host").toBe(true);
      expect(existsSync(`${hub.alpha}/e2e-change.txt`), "not on this hub").toBe(false);
    } finally {
      await peer.stop();
    }
  });
});
