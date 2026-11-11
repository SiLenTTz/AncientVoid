import type { Page } from "@playwright/test";
import { test, expect } from "../support/fixtures.ts";

/**
 * EPIC-P15 T15.2 / ADR-0033: Modus und Modell einer Session in der App wählen
 * und wechseln. Bewiesen wird am Init-Event des nächsten Zugs, was die (Attrappe
 * der) Claude-CLI wirklich bekam.
 */
test.describe("Modus und Modell", () => {
  const inits = async (hub: { events: (id: string) => Promise<{ summary: string; payload: Record<string, unknown> }[]> }, id: string) =>
    (await hub.events(id)).filter((e) => e.summary === "claude: system/init").map((e) => e.payload as { model?: string; permissionMode?: string });

  async function open(app: Page, origin: string, id: string) {
    await app.goto(`${origin}/#/sessions/${id}`);
    await expect(app.getByLabel("Modus")).toBeVisible();
  }

  test("eine neue Claude-Session läuft ohne Auswahl im Auto-Modus (AC-P15-1)", async ({ hub }) => {
    const id = await hub.createSession({ adapter: "claude", prompt: "Hallo" });
    await hub.until(async () => (await inits(hub, id)).length > 0, "init event");
    expect((await inits(hub, id))[0]).toMatchObject({ permissionMode: "auto" });
  });

  test("Modus und Modell wechseln in der App; der nächste Zug nutzt beides (AC-P15-2)", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "claude", prompt: "Hallo" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant"), "erste Antwort");
    await open(app, hub.origin, id);
    await expect(app.getByLabel("Modus")).toHaveValue("auto");

    await app.getByLabel("Modus").selectOption("plan");
    await expect.poll(async () => ((await hub.events(id)).find((e) => (e.payload as { kind?: string }).kind === "session.configured")?.payload as { permissionMode?: string } | undefined)?.permissionMode).toBe("plan");
    await app.getByLabel("Modell").selectOption("opus");
    await expect(app.getByLabel("Modell")).toHaveValue("opus");

    const before = (await inits(hub, id)).length;
    await app.getByPlaceholder("Antworten…").fill("Noch eine Frage");
    await app.getByRole("button", { name: "Senden" }).click();
    await hub.until(async () => (await inits(hub, id)).length > before, "zweiter Zug");
    expect((await inits(hub, id)).at(-1)).toMatchObject({ permissionMode: "plan", model: "opus" });
  });

  test("der Wechsel überlebt das Neuladen der Seite (AC-P15-3)", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "claude", prompt: "Hallo" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant"), "erste Antwort");
    await open(app, hub.origin, id);
    await app.getByLabel("Modus").selectOption("manual");
    await expect.poll(async () => (await hub.events(id)).some((e) => (e.payload as { kind?: string }).kind === "session.configured")).toBe(true);
    await app.reload();
    await expect(app.getByLabel("Modus")).toHaveValue("manual");
  });

  test("Adapter ohne wählbaren Modus zeigen keine Auswahl", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.locator(".dock-stack")).toBeVisible();
    await expect(app.getByLabel("Modus")).toHaveCount(0);
    await expect(app.getByLabel("Modell")).toHaveCount(0);
  });

  test("beim Anlegen lässt sich der Modus wählen", async ({ app, hub }) => {
    await app.goto(hub.origin);
    await app.getByRole("button", { name: "Neue Session" }).click();
    await app.getByLabel("Adapter").selectOption("claude");
    await expect(app.getByLabel("Modus")).toBeVisible();
    await expect(app.getByLabel("Modus").locator("option")).toContainText(["Standard des Hubs", "auto", "manual", "plan"]);
  });

  test("die gewählte Adapter-Wahl überlebt Neuladen und Rückkehr — sie gilt ab dem Klick, nicht erst ab dem Start (BUG-0105, EPIC-P35 T35.2)", async ({ app, hub }) => {
    await app.goto(hub.origin);
    await app.getByRole("button", { name: "Neue Session" }).click();
    await app.getByRole("combobox", { name: "Adapter", exact: true }).selectOption("codex");
    await app.reload();
    await app.getByRole("button", { name: "Neue Session" }).click();
    await expect(app.getByRole("combobox", { name: "Adapter", exact: true })).toHaveValue("codex");

    // Auch über Navigation (Remount ohne Reload) bleibt die Wahl stehen.
    await app.getByRole("combobox", { name: "Adapter", exact: true }).selectOption("pi");
    await app.locator(".dock").getByRole("button", { name: "Start", exact: true }).click();
    await app.getByRole("button", { name: "Neue Session" }).click();
    await expect(app.getByRole("combobox", { name: "Adapter", exact: true })).toHaveValue("pi");
  });
});
