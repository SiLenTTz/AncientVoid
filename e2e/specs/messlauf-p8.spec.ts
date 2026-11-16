import { writeFileSync, mkdirSync } from "node:fs";
import { test, expect, sessionTab, hostedRunner } from "../support/fixtures.ts";
import { TestHub } from "../support/hub.ts";

/**
 * T8.6 / AC-P8-1: five core tasks with 20 sessions on three hosts, mobile.
 * Counts taps and time per task; the numbers land in
 * test-results/messlauf-p8.json (docs/messlauf/…-p8-mobile.md).
 */
test.describe("Messlauf P8: Kernaufgaben mit 20 Sessions auf drei Hosts", () => {
  test.skip(hostedRunner, "BUG-0163: Lastmesslatte (20 Sessions × 3 Hosts) misst lokale Hardware");
  test.use({ hubOptions: { hostId: "workstation", label: "workstation" } });

  async function pair(home: TestHub, peer: TestHub): Promise<void> {
    const invite = await peer.api<{ code: string }>("/api/fleet/invites", { body: {} });
    const res = await home.api("/api/fleet/peers", { body: { url: peer.origin, code: invite.body.code } });
    expect(res.status).toBe(201);
  }

  test("AC-P8-1: jede wartende Anfrage in ≤ 2 Taps, ähnliche Sessions unterscheidbar, fünf Aufgaben gemessen", async ({ app, hub }, info) => {
    test.setTimeout(240_000);
    const server = await TestHub.start({ hostId: "home-server", label: "home-server" });
    const evox = await TestHub.start({ hostId: "gpubox", label: "gpubox" });
    try {
      await pair(hub, server);
      await pair(hub, evox);
      const hubs = [hub, server, evox];
      const topics = ["Parser-Tests reparieren", "Login-Seite aufräumen", "Build beschleunigen", "Doku ergänzen", "Abhängigkeiten aktualisieren", "Fehlerseite bauen", "Cache einführen"];
      const waiting: { host: string; id: string }[] = [];
      let n = 0;
      for (const [i, h] of hubs.entries()) {
        const count = i === 2 ? 6 : 7;
        for (let k = 0; k < count; k++) {
          n++;
          if (k === 0) {
            // One waiting tool approval per host.
            waiting.push({ host: ["workstation", "home-server", "gpubox"][i]!, id: await h.createSession({ adapter: "claude", prompt: `Bitte WERKZEUG ${topics[k]}` }) });
          } else {
            await h.createSession({ adapter: "opencode", prompt: `${topics[k]} (${n})`, project: k % 2 ? h.beta : h.alpha });
          }
        }
      }
      const results: Record<string, { taps: number; ms: number; note?: string }> = {};
      const measure = async (name: string, fn: (tap: () => void) => Promise<string | void>) => {
        let taps = 0;
        const t0 = Date.now();
        const note = await fn(() => void taps++);
        results[name] = { taps, ms: Date.now() - t0, ...(note ? { note } : {}) };
      };

      await app.reload();
      await expect(app.locator(".session-card")).toHaveCount(20, { timeout: 30_000 });
      await expect(app.locator(".section-braucht .session-card.st-waiting")).toHaveCount(3, { timeout: 20_000 });

      // 1. Each waiting request: from the overview to the decision.
      for (const w of waiting) {
        await measure(`Freigabe öffnen (${w.host})`, async (tap) => {
          const card = app.locator(".section-braucht .session-card.st-waiting").filter({ hasText: w.host === "workstation" ? "workstation ·" : `${w.host} ·` });
          tap();
          await card.locator(".session-open").click();
          await expect(app.locator(".session-approvals .approval-card")).toBeVisible({ timeout: 15_000 });
          tap();
          await app.locator(".session-approvals .approval-card").getByRole("button", { name: "Erlauben" }).click();
          await expect(app.locator(".session-approvals .approval-card")).toHaveCount(0, { timeout: 15_000 });
        });
        expect(results[`Freigabe öffnen (${w.host})`]!.taps, "AC-P8-1: ≤ 2 Taps").toBeLessThanOrEqual(2);
        await app.getByLabel("Zur Übersicht").click();
      }

      // 2. Two similar sessions: tell them apart.
      await measure("ähnliche Sessions unterscheiden", async (tap) => {
        tap();
        await app.getByLabel("Sessions filtern").fill("Parser");
        const cards = app.locator(".session-card");
        await expect(cards).toHaveCount(3);
        const where = await cards.locator(".session-where").allTextContents();
        expect(new Set(where.map((w) => w.split(" · ")[0])).size).toBe(3);
        await app.getByLabel("Sessions filtern").fill("");
        return where.join(" | ");
      });
      expect(results["ähnliche Sessions unterscheiden"]!.ms, "AC-P8-1: ≤ 5 s").toBeLessThan(5000);

      // 3. Reply to a session.
      await measure("antworten", async (tap) => {
        tap();
        await app.locator(".session-card").filter({ hasText: "Doku ergänzen" }).first().locator(".session-open").click();
        tap();
        await app.getByPlaceholder("Antworten…").fill("Bitte mit Beispielen");
        tap();
        await app.getByRole("button", { name: /^(Senden|Weiter)$/ }).click();
        await expect(app.locator(".tail-scroll").getByText(/Antwort auf: Bitte mit Beispielen/)).toBeVisible({ timeout: 15_000 });
      });
      await app.getByLabel("Zur Übersicht").click();

      // 4. Start a new session.
      await measure("neue Session starten", async (tap) => {
        tap();
        await app.getByRole("button", { name: "Neue Session" }).click();
        tap();
        await app.getByPlaceholder("Refactore den Auth-Flow…").fill("Neue Aufgabe vom Handy");
        tap();
        await app.getByRole("button", { name: "Starten" }).click();
        await expect(app.locator(".session-top-title")).toHaveText("Neue Aufgabe vom Handy", { timeout: 15_000 });
      });

      // 5. Find a function in the session's code.
      await measure("Code finden", async (tap) => {
        tap();
        await sessionTab(app, "Code");
        tap();
        await app.getByLabel("Code durchsuchen").fill("parseToken");
        tap();
        await app.getByRole("button", { name: "Suchen" }).click();
        tap();
        await app.locator(".code-hit").first().click();
        await expect(app.locator(".code-lines li.hit")).toBeVisible();
      });

      const out = { date: new Date().toISOString(), viewport: app.viewportSize(), sessions: 20, hosts: 3, results };
      mkdirSync("test-results", { recursive: true });
      writeFileSync("test-results/messlauf-p8.json", JSON.stringify(out, null, 2));
      info.annotations.push({ type: "messlauf", description: JSON.stringify(results) });
    } finally {
      await server.stop();
      await evox.stop();
    }
  });
});
