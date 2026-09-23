import type { Page } from "@playwright/test";
import { test, expect } from "../support/fixtures.ts";

async function lastMessageCovered(app: Page): Promise<number> {
  return app.evaluate(() => {
    const doc = (globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ getBoundingClientRect(): { top: number; bottom: number } }>; querySelector(s: string): { getBoundingClientRect(): { top: number } } | null } }).document;
    const events = doc.querySelectorAll(".event");
    const last = events[events.length - 1];
    const dock = doc.querySelector(".dock-stack");
    if (!last || !dock) return -1;
    return Math.max(0, last.getBoundingClientRect().bottom - dock.getBoundingClientRect().top);
  });
}

test.describe("Session-Layout (Bedienelemente)", () => {
  test("die letzte Nachricht liegt über der Steuerung, auch mit hohem Composer @desktop", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Erster Zug" });
    for (const text of ["Zweiter", "Dritter", "Vierter"]) {
      await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "idle");
      await hub.api(`/api/sessions/${id}/steer`, { body: { kind: "prompt", text } });
    }
    await hub.until(async () => (await hub.events(id)).filter((e) => e.type === "assistant").length === 4, "4 answers");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByRole("button", { name: "Chat" }).click();
    await expect(app.getByText(/Antwort auf: Vierter/)).toBeVisible();
    await app.getByPlaceholder("Antworten…").fill("Zeile 1\nZeile 2\nZeile 3\nZeile 4\nZeile 5\nZeile 6");
    await app.locator(".tail-scroll").evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await expect.poll(() => lastMessageCovered(app)).toBe(0);
  });

  test("die Steuerung lässt sich aus- und einblenden und bleibt so", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Erster Zug" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.getByPlaceholder("Antworten…")).toBeVisible();
    await app.getByRole("button", { name: "Steuerung ausblenden" }).click();
    await expect(app.getByPlaceholder("Antworten…")).toHaveCount(0);
    await expect(app.getByRole("button", { name: "Chat" })).toBeVisible();
    await app.reload();
    await expect(app.getByRole("button", { name: "Steuerung einblenden" })).toBeVisible();
    await app.getByRole("button", { name: "Steuerung einblenden" }).click();
    await expect(app.getByPlaceholder("Antworten…")).toBeVisible();
  });
});
