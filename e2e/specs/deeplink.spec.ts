import { test, expect } from "../support/fixtures.ts";

test.describe("Deep-Link und Attach (AC-P5-5)", () => {
  test("ein Session-Link öffnet nach Reload dieselbe Session @desktop", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.locator(".topbar")).toContainText("dummy");
    await app.reload();
    await expect(app.locator(".topbar")).toContainText("dummy");
    expect(app.url()).toContain(`#/sessions/${id}`);
  });

  test("ein unbekannter Link landet in der Übersicht", async ({ app, hub }) => {
    await app.goto(`${hub.origin}/#/sessions/gibt-es-nicht`);
    await expect(app.getByText("keine Sessions — lege eine an")).toBeVisible();
  });

  test("ohne tmux gibt es nie einen Attach-Befehl", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Arbeite LANGSAM" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByRole("button", { name: "Bericht" }).click();
    await expect(app.locator(".kv-list")).toBeVisible();
    await expect(app.locator(".attach-cmd-card")).toHaveCount(0);
  });

  test.describe("mit tmux-Worker", () => {
    test.use({ hubOptions: { runner: "tmux" } });

    test("Attach nur, solange ein Worker läuft", async ({ app, hub }) => {
      const id = await hub.createSession({ adapter: "opencode", prompt: "Arbeite LANGSAM" });
      await hub.until(async () => (await hub.events(id)).some((e) => e.type === "tool_use"), "worker running");
      await app.goto(`${hub.origin}/#/sessions/${id}`);
      await app.getByRole("button", { name: "Bericht" }).click();
      await expect(app.locator(".attach-cmd-card code")).toHaveText(`tmux attach -t uacc-${id}`);
      await app.getByRole("button", { name: "Stop" }).click();
      await expect(app.locator(".topbar .pill")).toHaveText("stopped");
      await expect(app.locator(".attach-cmd-card")).toHaveCount(0);
    });
  });

  test("zwischen zwei Zügen gibt es den Terminal-Befehl für dieselbe Provider-Session (T5.5) @desktop", async ({ app, hub }) => {
    await app.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: hub.origin });
    const id = await hub.createSession({ adapter: "opencode", prompt: "Erster Zug" });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "turn over");
    const native = (await hub.api<{ nativeSessionId: string }>(`/api/sessions/${id}`)).body.nativeSessionId;
    const workdir = String((await hub.events(id)).find((e) => e.payload.kind === "session.created")?.payload.workdir);

    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByRole("button", { name: "Bericht" }).click();
    await expect(app.locator(".continue-open")).toHaveText(`cd ${workdir} && opencode --session ${native}`);
    await expect(app.locator(".continue-link")).toHaveText(`${hub.origin}/#/sessions/${id}`);
    await app.locator(".continue-card .attach-cmd-row").last().getByRole("button", { name: "Kopieren" }).click();
    await expect(app.locator(".continue-card").getByRole("button", { name: "Kopiert" })).toBeVisible();
    expect(await app.evaluate(() => (globalThis as unknown as { navigator: { clipboard: { readText(): Promise<string> } } }).navigator.clipboard.readText())).toBe(
      `cd ${workdir} && opencode --session ${native}`,
    );
  });

  test("während ein Zug läuft, gibt es keinen Terminal-Befehl", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Arbeite LANGSAM" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "tool_use"), "turn running");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByRole("button", { name: "Bericht" }).click();
    await expect(app.locator(".continue-none")).toBeVisible();
    await expect(app.locator(".continue-open")).toHaveCount(0);
    await expect(app.locator(".continue-link")).toContainText(`#/sessions/${id}`);
  });

  test("der Bericht sagt, wo die Änderungen liegen (Worktree statt Projektordner)", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Lege eine DATEI an" });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "turn over");
    const workdir = String((await hub.events(id)).find((e) => e.payload.kind === "session.created")?.payload.workdir);
    expect(workdir).not.toBe(hub.alpha);
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByRole("button", { name: "Bericht" }).click();
    await expect(app.locator(".worktree-card")).toContainText(`uacc/${id}`);
    await expect(app.locator(".worktree-card")).toContainText("nicht in alpha");
    await expect(app.locator(".worktree-path")).toHaveText(workdir);
    await expect(app.locator(".worktree-open")).toHaveText(`code ${workdir}`);

    await app.getByRole("button", { name: "Stop" }).click();
    await expect(app.locator(".topbar .pill")).toHaveText("stopped");
    await hub.until(async () => (await hub.events(id)).some((e) => e.payload.kind === "session.worktree_kept"), "worktree kept");
    const { existsSync } = await import("node:fs");
    expect(existsSync(`${workdir}/e2e-change.txt`), "the agent's file survived Stop (BUG-0027)").toBe(true);
  });
});
