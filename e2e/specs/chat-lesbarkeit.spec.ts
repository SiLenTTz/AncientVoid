import { test, expect, sessionTab } from "../support/fixtures.ts";

test("große Werkzeugergebnisse bleiben ihrem Schritt zugeordnet @tablet @desktop", async ({ app, hub }) => {
  const id = await hub.createSession({ adapter: "opencode", prompt: "GROSS" });
  await hub.until(async () => (await hub.sessions()).every((s) => s.status === "idle"), "Zug fertig");
  await app.goto(`${hub.origin}/#/sessions/${id}`);
  await sessionTab(app, "Chat");
  const work = app.locator(".turn-work");
  await expect(work.locator(".turn-summary")).toContainText("1 Schritt · 1 gelesen");
  await work.locator(".turn-summary").click();
  await expect(work.locator(".turn-step")).toHaveCount(1);
  await expect(work.locator(".turn-step")).toHaveClass(/ok/);
  await work.locator(".turn-step-head").click();
  await expect(work.locator(".turn-step-io")).toContainText("x".repeat(5000));
});

test("große Eingaben und Denktexte bleiben im aufklappbaren Denkpfad lesbar @tablet @desktop", async ({ app, hub }) => {
  const id = await hub.createSession({ adapter: "opencode", prompt: "DENKPFAD" });
  await hub.until(async () => (await hub.sessions()).every((s) => s.status === "idle"), "Zug fertig");
  await app.goto(`${hub.origin}/#/sessions/${id}`);
  await sessionTab(app, "Chat");
  const work = app.locator(".turn-work");
  await expect(work.locator(".turn-summary")).toContainText("2 Schritte · 1 gelesen · 1 ausgeführt");
  await work.locator(".turn-summary").click();
  await expect(work.locator(".turn-step")).toHaveCount(2);
  await expect(work.locator(".turn-step-target").last()).toHaveText("echo fertig");
  await work.locator(".turn-note-toggle").click();
  await expect(work.locator(".turn-note .event-detail")).toContainText("ENDE DES DENKENS");
});
