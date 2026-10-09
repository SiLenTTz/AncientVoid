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

    writeFileSync(agentsFile, JSON.stringify([{ pid: 4711, cwd: "/p/x", kind: "interactive", startedAt: 1, sessionId: native, name: "mobile-hub-fc", status: "idle" }]));
    await app.reload();
    await expect(app.locator(".pc-open-notice")).toContainText("Am PC offen (mobile-hub-fc)");
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
});
