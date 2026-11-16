import { devices, type Browser, type Page } from "@playwright/test";
import { test, expect } from "../support/fixtures.ts";
import type { TestHub } from "../support/hub.ts";

/**
 * AC-P5-2, automated: the same provider session moves PC → phone → PC.
 * Checked per turn: same native session id, same working directory, no
 * double turn. The manual run against real providers stays the formal
 * acceptance; this is the regression gate for it.
 */
async function device(browser: Browser, hub: TestHub, kind: "phone" | "pc"): Promise<Page> {
  const context = await browser.newContext(kind === "phone" ? devices["Pixel 7"] : devices["Desktop Chrome"]);
  const page = await context.newPage();
  await page.addInitScript((token) => localStorage.setItem("ancientvoid.token", token), hub.token);
  return page;
}

function turns(events: { type: string; payload: Record<string, unknown> }[]) {
  return events
    .filter((e) => e.type === "assistant")
    .map((e) => {
      const text = String(e.payload.text);
      return { text, native: /Session (ses_e2e_\w+)/.exec(text)?.[1], cwd: / · cwd (.+)$/.exec(text)?.[1] };
    });
}

async function send(page: Page, text: string): Promise<void> {
  await page.getByRole("button", { name: "Chat" }).click();
  await page.getByPlaceholder("Antworten…").fill(text);
  await page.getByRole("button", { name: /^(Senden|Weiter)$/ }).click();
}

test.describe("Handoff PC ↔ Handy (AC-P5-2) @desktop", () => {
  test.skip(({ isMobile }) => isMobile, "drives both form factors itself; runs in the desktop project");

  test("PC → Handy → PC während die Session lebt", async ({ browser, hub }) => {
    const pc = await device(browser, hub, "pc");
    await pc.goto(hub.origin);
    await pc.getByRole("button", { name: "Neue Session" }).click();
    await pc.getByLabel("Adapter").selectOption("opencode");
    await pc.getByPlaceholder("Refactore den Auth-Flow…").fill("Zug 1 am PC");
    await pc.getByRole("button", { name: "Starten" }).click();
    await pc.getByRole("button", { name: "Chat" }).click();
    await expect(pc.locator(".tail-scroll").getByText(/Antwort auf: Zug 1 am PC/)).toBeVisible();
    const link = pc.url();

    const phone = await device(browser, hub, "phone");
    await phone.goto(link);
    await phone.getByRole("button", { name: "Chat" }).click();
    await expect(phone.locator(".tail-scroll").getByText(/Antwort auf: Zug 1 am PC/)).toBeVisible();
    await send(phone, "Zug 2 vom Handy");
    await expect(phone.locator(".tail-scroll").getByText(/Antwort auf: Zug 2 vom Handy/)).toBeVisible();
    await expect(pc.locator(".tail-scroll").getByText(/Antwort auf: Zug 2 vom Handy/), "PC sees the phone's turn live").toBeVisible();

    await send(pc, "Zug 3 am PC");
    await expect(pc.getByText("Ein anderes Gerät schreibt gerade in diese Session.")).toBeVisible();
    await pc.getByRole("button", { name: "Übernehmen", exact: true }).click();
    await expect(pc.locator(".tail-scroll").getByText(/Antwort auf: Zug 3 am PC/)).toBeVisible();
    await expect(phone.locator(".tail-scroll").getByText(/Antwort auf: Zug 3 am PC/)).toBeVisible();

    const id = decodeURIComponent(link.split("#/sessions/")[1]!);
    const all = turns(await hub.events(id));
    expect(all.map((t) => t.text.split(" · ")[0])).toEqual([
      "Antwort auf: Zug 1 am PC",
      "Antwort auf: Zug 2 vom Handy",
      "Antwort auf: Zug 3 am PC",
    ]);
    expect(new Set(all.map((t) => t.native)).size, "one native provider session").toBe(1);
    expect(new Set(all.map((t) => t.cwd)).size, "one working directory").toBe(1);
  });

  test("PC stoppt, das Handy macht weiter, der PC übernimmt wieder", async ({ browser, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Zug 1 am PC" });
    await hub.until(async () => turns(await hub.events(id)).length === 1, "first turn");
    const pc = await device(browser, hub, "pc");
    await pc.goto(`${hub.origin}/#/sessions/${id}`);
    await pc.getByRole("button", { name: "Stop" }).click();
    await expect(pc.locator(".topbar .status")).toHaveAttribute("data-status", "stopped");

    const phone = await device(browser, hub, "phone");
    await phone.goto(`${hub.origin}/#/sessions/${id}`);
    await send(phone, "Zug 2 vom Handy");
    await expect(phone.locator(".tail-scroll").getByText(/Antwort auf: Zug 2 vom Handy .*\(fortgesetzt\)/)).toBeVisible();

    await phone.getByRole("button", { name: "Stop" }).click();
    await expect(pc.locator(".topbar .status")).toHaveAttribute("data-status", "stopped");
    await send(pc, "Zug 3 am PC");
    await pc.getByRole("button", { name: "Übernehmen", exact: true }).click();
    await expect(pc.locator(".tail-scroll").getByText(/Antwort auf: Zug 3 am PC .*\(fortgesetzt\)/)).toBeVisible();

    const all = turns(await hub.events(id));
    expect(all).toHaveLength(3);
    expect(new Set(all.map((t) => t.native)).size).toBe(1);
    expect(new Set(all.map((t) => t.cwd)).size).toBe(1);
  });
});
