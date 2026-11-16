import type { Locator, Page } from "@playwright/test";
import { test, expect, hostedRunner } from "../support/fixtures.ts";
import type { TestHub } from "../support/hub.ts";

/**
 * EPIC-P43 AC-P43-2 / K1: eine entscheidbare Freigabe mit einem Tipp — aus Start und aus dem Nyx-Blatt.
 * Gemessen wird Tipp → `decide`-Antwort des Hubs (Wanduhr des Testprozesses, also eher zu lang als zu kurz).
 * Im Gate je Weg 5 Runden; `K1_RUNS=20` ist der Messlauf (docs/messlauf/2026-11-11-p43-k1-k2.md).
 * Ohne Push und ohne Passkey: das sind die Freigaben, die P43 auf einen Tipp bringt.
 */
const RUNS = Number(process.env.K1_RUNS ?? 5);
const K1_MS = 5000;

const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1]!;

async function pendingFor(hub: TestHub, id: string) {
  await hub.until(async () => (await hub.api<{ sessionId: string; status: string }[]>("/api/approvals?status=pending")).body.some((a) => a.sessionId === id), "Freigabe wartet");
}

async function tap(app: Page, button: Locator): Promise<number> {
  await expect(button).toBeVisible();
  const t0 = Date.now();
  await Promise.all([app.waitForResponse((r) => r.url().includes("/decide") && r.request().method() === "POST" && r.ok()), button.click()]);
  return Date.now() - t0;
}

test.describe("K1: Freigabe mit einem Tipp (EPIC-P43 AC-P43-2)", () => {
  test("aus Start und aus dem Nyx-Blatt bleibt Tipp → Hub-Quittung unter 5 s (p95)", async ({ app, hub }, info) => {
    test.skip(hostedRunner, "BUG-0163: K1-p95-Messlatte misst lokale Hardware");
    test.setTimeout(60_000 + RUNS * 2 * 10_000);
    const start: number[] = [];
    const nyx: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const a = await hub.createSession({ adapter: "claude", prompt: `Bitte WERKZEUG Start ${i}` });
      await pendingFor(hub, a);
      // Eine wartende Freigabe steht immer in „Du bist dran“ — „Ruhig“ muss nicht auf.
      await app.goto(hub.origin);
      start.push(await tap(app, app.locator(".session-card").filter({ hasText: `Start ${i}` }).locator(".card-decision").getByRole("button", { name: "Erlauben" })));

      const b = await hub.createSession({ adapter: "claude", prompt: `Bitte WERKZEUG Nyx ${i}` });
      await pendingFor(hub, b);
      await app.locator(".topbar .nyx-button").click();
      const item = app.getByRole("dialog", { name: "Nyx" }).locator(".nyx-item").filter({ hasText: `Nyx ${i}` });
      nyx.push(await tap(app, item.getByRole("button", { name: "Erlauben" })));
      await app.keyboard.press("Escape");
    }
    const line = (name: string, xs: number[]) => {
      const s = [...xs].sort((x, y) => x - y);
      return `${name}: n=${s.length} min=${s[0]} median=${s[Math.floor(s.length / 2)]} p95=${p95(s)} max=${s[s.length - 1]} ms`;
    };
    await info.attach("k1.txt", { body: `${line("Start", start)}\n${line("Nyx", nyx)}\n`, contentType: "text/plain" });
    console.log(`K1 ${line("Start", start)}\nK1 ${line("Nyx", nyx)}`);
    expect(p95(start), "K1 aus Start").toBeLessThan(K1_MS);
    expect(p95(nyx), "K1 aus dem Nyx-Blatt").toBeLessThan(K1_MS);
  });
});
