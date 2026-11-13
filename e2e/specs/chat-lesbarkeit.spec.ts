import { test, expect, sessionTab } from "../support/fixtures.ts";

test("letzter Auftrag bleibt oben, aktualisiert sich und springt zur Nachricht @tablet @desktop", async ({ app, hub }) => {
  const prompt = `Auftrag mit langem Inhalt\n\`\`\`text\n${"sehrlangezeile".repeat(100)}\n\`\`\``;
  const id = await hub.createSession({ adapter: "opencode", prompt });
  await hub.until(async () => (await hub.sessions()).every((s) => s.status === "idle"), "Zug fertig");
  await app.goto(`${hub.origin}/#/sessions/${id}`);
  await sessionTab(app, "Chat");
  const pin = app.getByRole("button", { name: /Letzter Auftrag/ });
  await expect(pin).toContainText("Auftrag mit langem Inhalt");
  const tail = app.locator(".tail-scroll").first();
  await tail.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(pin).toBeInViewport();
  await pin.click();
  await expect(tail.locator(".event.user").first()).toBeInViewport();
  const overflow = await tail.evaluate((el) => [el, ...el.querySelectorAll("*")].filter((node) => {
    const style = getComputedStyle(node);
    return /auto|scroll/.test(style.overflowX) && node.scrollWidth > node.clientWidth + 1;
  }).map((node) => node.className));
  expect(overflow).toEqual([]);

  const reply = await hub.api<{ ok: boolean }>(`/api/sessions/${id}/steer`, { body: { kind: "prompt", text: "Neuer Auftrag" } });
  expect(reply.body.ok).toBe(true);
  await expect(pin).toContainText("Neuer Auftrag");
  await app.reload();
  await expect(pin).toContainText("Neuer Auftrag");
});

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

test("Auftrag vor der Live-Baseline ist auch nach Neuladen erreichbar @tablet @desktop", async ({ app, hub }) => {
  const id = await hub.createSession({ adapter: "opencode", prompt: "LANGER_VERLAUF: ursprünglicher Auftrag" });
  await hub.until(async () => (await hub.sessions()).every((s) => s.status === "idle"), "Zug fertig");
  await app.goto(`${hub.origin}/#/sessions/${id}`);
  await sessionTab(app, "Chat");
  const pin = app.getByRole("button", { name: /Letzter Auftrag/ });
  await expect(pin).toContainText("ursprünglicher Auftrag");
  await pin.click();
  await expect(app.locator(".tail-scroll .event.user")).toBeInViewport();
  await app.reload();
  await expect(pin).toContainText("ursprünglicher Auftrag");
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
