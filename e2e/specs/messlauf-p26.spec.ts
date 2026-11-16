import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, hostedRunner } from "../support/fixtures.ts";

/**
 * EPIC-P26 T26.10: Messlauf gegen die `factory`-Attrappe — K9 (Störung sichtbar), AC-P26-2
 * (Dateiänderung → Panel), K7/AC-P26-6 (Hub-Crash mitten im Lauf). Zahlen landen in
 * test-results/messlauf-p26.json (docs/messlauf/2026-11-09-p26-factory.md). Nur das Hub-/PWA-Ende:
 * die echte Factory misst die manuelle Abnahme.
 */
const N = 8;
const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return { n: s.length, min: s[0], median: s[Math.floor(s.length / 2)], p95: s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)], max: s.at(-1) };
};

test.describe("Messlauf P26", () => {
  test.skip(hostedRunner, "BUG-0163: Messlatte n=8 misst lokale Hardware");
  test("K9, AC-P26-2 und K7 mit n=8", async ({ app, hub }, info) => {
    test.setTimeout(180_000);
    const project = join(hub.projectsDir, "messlauf");
    mkdirSync(join(project, ".factory", "intake"), { recursive: true });
    writeFileSync(join(project, ".factory", "config.json"), JSON.stringify({ schema_version: "1" }));
    writeFileSync(join(project, ".factory", "intake", "state.json"), JSON.stringify({ schema_version: "1", status: "ready", execution_ready: true }));
    const progress = (v: Record<string, unknown>) => writeFileSync(join(project, ".factory", "stand-in.json"), JSON.stringify(v));
    progress({ done: 0, total: 100 });
    execSync("git init -q", { cwd: project });
    const start = await hub.api<{ driver: { id: string }; observer: { id: string } }>("/api/factory/start", { method: "POST", body: { project, goal: "Messlauf" } });
    const { driver, observer } = { driver: start.body.driver.id, observer: start.body.observer.id };
    await app.goto(`${hub.origin}/#/sessions/${observer}`);
    const panel = app.locator(".loop-panel");
    await expect(panel).toContainText("0 von 100 Aufgaben", { timeout: 15_000 });

    const panelMs: number[] = [];
    for (let i = 1; i <= N; i++) {
      const t0 = Date.now();
      progress({ done: i, total: 100 });
      await expect(panel).toContainText(`${i} von 100 Aufgaben`, { timeout: 15_000 });
      panelMs.push(Date.now() - t0);
    }

    const brokenMs: number[] = [];
    const count = async (kind: string) => (await hub.events(observer)).filter((e) => e.payload.kind === kind).length;
    for (let i = 0; i < N; i++) {
      const brokenBefore = await count("loop.broken");
      const recoveredBefore = await count("loop.recovered");
      const t0 = Date.now();
      progress({ garbage: true });
      await hub.until(async () => (await count("loop.broken")) > brokenBefore, "loop.broken", 15_000);
      brokenMs.push(Date.now() - t0);
      progress({ done: 50, total: 100 });
      await hub.until(async () => (await count("loop.recovered")) > recoveredBefore, "loop.recovered", 15_000);
    }

    const restartMs: number[] = [];
    const ids = (await hub.api<{ id: string }[]>("/api/sessions")).body.map((s) => s.id).sort();
    for (let i = 0; i < N; i++) {
      restartMs.push(await hub.restart("SIGKILL"));
      expect((await hub.api<{ id: string }[]>("/api/sessions")).body.map((s) => s.id).sort()).toEqual(ids);
    }
    for (const id of [driver, observer]) expect((await hub.events(id)).filter((e) => e.payload.kind === "factory.linkage")).toHaveLength(1);
    const seqs = (await hub.events(observer)).map((e) => e.seq);
    expect(new Set(seqs).size, "keine doppelten Ereignisse").toBe(seqs.length);

    const out = { panel: stats(panelMs), broken: stats(brokenMs), restart: stats(restartMs), pollMs: 500 };
    mkdirSync("test-results", { recursive: true });
    writeFileSync("test-results/messlauf-p26.json", JSON.stringify(out, null, 2));
    await info.attach("messlauf-p26.json", { body: JSON.stringify(out, null, 2), contentType: "application/json" });
    // Grenzen der Messlatten: AC-P26-2 ≤ 15 s, K9 < 60 s, AC-P26-6 < 3 s
    expect(out.panel.max!).toBeLessThan(15_000);
    expect(out.broken.max!).toBeLessThan(60_000);
  });
});
