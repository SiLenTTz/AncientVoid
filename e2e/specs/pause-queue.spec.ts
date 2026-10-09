import type { Page } from "@playwright/test";
import { test, expect } from "../support/fixtures.ts";

/**
 * EPIC-P15 T15.3: Nachrichten vormerken und eine laufende Session pausieren.
 * Die Attrappe der Claude-CLI hält den Zug mit LANGSAM offen, mit ZUEGIG 3 s.
 */
test.describe("Pause und Warteschlange", () => {
  const sessionPrompts = async (hub: { events: (id: string) => Promise<{ type: string; summary: string; payload: Record<string, unknown> }[]> }, id: string) =>
    (await hub.events(id)).filter((e) => (e.payload as { kind?: string }).kind === "session.prompt" || e.type === "user").map((e) => e.summary);

  async function open(app: Page, origin: string, id: string) {
    await app.goto(`${origin}/#/sessions/${id}`);
    await expect(app.getByPlaceholder("Antworten…")).toBeVisible();
  }

  test("Vormerken: die Nachricht wartet, steht in der Liste und geht am Zugende raus (AC-P15-4)", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "claude", prompt: "ZUEGIG erste Frage" });
    await open(app, hub.origin, id);
    await app.getByPlaceholder("Antworten…").fill("zweite Frage danach");
    await app.getByRole("button", { name: "Vormerken" }).click();
    await expect(app.locator(".queue-list")).toContainText("zweite Frage danach");
    // ... und sie geht nach dem Zugende genau einmal raus:
    await expect(app.locator(".queue-list")).toHaveCount(0, { timeout: 20_000 });
    await hub.until(async () => (await sessionPrompts(hub, id)).filter((t) => t.includes("zweite Frage danach")).length >= 1, "vorgemerkter Prompt gesendet", 20_000);
    expect((await sessionPrompts(hub, id)).filter((t) => t.includes("zweite Frage danach"))).toHaveLength(1);
  });

  test("eine vorgemerkte Nachricht lässt sich streichen — sie geht nie raus", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "claude", prompt: "LANGSAM erste Frage" });
    await open(app, hub.origin, id);
    await app.getByPlaceholder("Antworten…").fill("doch nicht");
    await app.getByRole("button", { name: "Vormerken" }).click();
    await expect(app.locator(".queue-list")).toContainText("doch nicht");
    await app.getByRole("button", { name: /Vorgemerkte Nachricht 1 streichen/ }).click();
    await expect(app.locator(".queue-list")).toHaveCount(0);
    expect(await sessionPrompts(hub, id)).not.toContain("doch nicht");
  });

  test("Pause hält den Zug an, die Session steht auf pausiert und läuft mit „Weiter“ wieder (AC-P15-4)", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "claude", prompt: "LANGSAM erste Frage" });
    await open(app, hub.origin, id);
    await app.getByRole("button", { name: "Pause" }).click();
    await expect(app.locator(".session-top-meta .pill")).toHaveText("pausiert");
    await expect(app.getByRole("button", { name: "Pause" })).toHaveCount(0);
    await app.getByPlaceholder("Antworten…").fill("mach bitte weiter");
    await app.getByRole("button", { name: "Weiter" }).click();
    await expect(app.locator(".session-top-meta .pill")).not.toHaveText("pausiert");
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant" && e.summary.length > 0), "Antwort nach der Pause", 20_000);
  });

  test("Adapter ohne Anhalten zeigen keinen Pause-Knopf", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "claude-clip" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.locator(".dock-stack")).toBeVisible();
    await expect(app.getByRole("button", { name: "Pause" })).toHaveCount(0);
  });
});
