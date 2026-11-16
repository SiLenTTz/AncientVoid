import { writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { test, expect } from "../support/fixtures.ts";

/**
 * EPIC-P15 T15.4: die App sagt, wenn eine Session am PC offen ist — die
 * interaktive Claude Code liest Eingaben vom Handy nicht von selbst nach.
 */
const agentsFile = resolve(import.meta.dirname, "../support/bin/agents.json");

test.describe("Am PC offen", () => {
  test.describe.configure({ mode: "serial" }); // eine gemeinsame agents.json

  test.afterAll(() => rmSync(agentsFile, { force: true }));

  async function nativeId(hub: { origin: string; token: string }, id: string): Promise<string> {
    const res = await fetch(`${hub.origin}/api/sessions/${id}`, { headers: { authorization: `Bearer ${hub.token}` } });
    return ((await res.json()) as { nativeSessionId?: string }).nativeSessionId ?? "";
  }

  test("eine am PC offene Session zeigt den Hinweis mit Namen und Befehl; ohne PC-Sitzung keinen", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "claude", prompt: "Hallo" });
    await hub.until(async () => (await nativeId(hub, id)) !== "", "native session id");
    const native = await nativeId(hub, id);

    rmSync(agentsFile, { force: true });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.getByPlaceholder("Antworten…")).toBeVisible();
    await expect(app.locator(".pc-open-notice")).toHaveCount(0);

    writeFileSync(agentsFile, JSON.stringify([{ pid: 4711, cwd: "/p/x", kind: "interactive", startedAt: 1, sessionId: native, name: "AncientVoid-fc", status: "idle" }]));
    // ClaudeLive hält `claude agents` 3 s im Speicher: erst danach sieht der Hub die neue Datei.
    await app.waitForTimeout(3500);
    await app.reload();
    await expect(app.locator(".pc-open-notice")).toContainText("Am PC offen (AncientVoid-fc)");
    await expect(app.locator(".pc-open-notice code")).toContainText(`claude --resume ${native}`);
  });

  test("eine Hintergrund-Session nennt `claude attach`", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "claude", prompt: "Hallo" });
    await hub.until(async () => (await nativeId(hub, id)) !== "", "native session id");
    const native = await nativeId(hub, id);
    writeFileSync(agentsFile, JSON.stringify([{ id: native.slice(0, 8), cwd: "/p/x", kind: "background", startedAt: 1, sessionId: native, name: "Hintergrund", state: "idle" }]));
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.locator(".pc-open-notice code")).toContainText(`claude attach ${native.slice(0, 8)}`);
  });

  test("BUG-0049: ein leerer oder fehlgeschlagener Abruf lässt Hinweis, Auswahl und Meldungen in Ruhe", async ({ app, hub }) => {
    test.setTimeout(75_000);
    const id = await hub.createSession({ adapter: "claude", prompt: "Hallo" });
    await hub.until(async () => (await nativeId(hub, id)) !== "", "native session id");
    const native = await nativeId(hub, id);
    writeFileSync(agentsFile, JSON.stringify([{ pid: 4711, cwd: "/p/x", kind: "interactive", startedAt: 1, sessionId: native, name: "AncientVoid-fc", status: "idle" }]));

    let pcCalls = 0;
    let noteCalls = 0;
    // Zweiter Abruf der PC-Frage: „nicht offen“; jeder zweite Abruf der Meldungen und der Modelle scheitert.
    await app.route("**/api/sessions/*/pc", (route) => (++pcCalls === 2 ? route.fulfill({ json: { open: false } }) : route.continue()));
    await app.route("**/api/notifications*", (route) => (noteCalls++ % 2 === 1 ? route.abort() : route.continue()));
    await app.route("**/api/adapters/*/models", (route) => route.abort());
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.locator(".pc-open-notice")).toBeVisible();
    await expect(app.getByLabel("Modus")).toBeVisible();

    await app.evaluate(`
      (() => {
        const w = window;
        w.__calm = { vanished: 0, toasts: 0, present: { notice: true, configure: true } };
        const check = () => {
          for (const [key, sel] of [["notice", ".pc-open-notice"], ["configure", ".session-configure"]]) {
            const now = !!document.querySelector(sel);
            if (!now && w.__calm.present[key]) w.__calm.vanished += 1;
            w.__calm.present[key] = now;
          }
          w.__calm.toasts = Math.max(w.__calm.toasts, document.querySelectorAll(".toast").length);
        };
        new MutationObserver(check).observe(document.body, { childList: true, subtree: true });
      })()
    `);
    await expect.poll(() => pcCalls, { timeout: 45_000 }).toBeGreaterThanOrEqual(3); // der leere Abruf war dabei
    await app.waitForTimeout(2500);
    const calm = (await app.evaluate(`window.__calm`)) as { vanished: number; toasts: number };
    expect(calm.vanished).toBe(0);
    expect(calm.toasts).toBe(0);
  });
});
