import { test, expect, openFromOverview } from "../support/fixtures.ts";

test.describe("Hub-Neustart (AC-P5-3, K7, BUG-0018)", () => {
  test.describe("laufende Session", () => {
    test.use({ hubOptions: { dummyAutoStop: 0 } });

    test("harter Kill: bestätigte Events bleiben exakt, die Session bleibt steuerbar @desktop", async ({ app, hub }, info) => {
      const id = await hub.createSession({ adapter: "dummy" });
      await app.goto(`${hub.origin}/#/sessions/${id}`);
      await app.getByRole("button", { name: "Verlauf" }).click();
      await expect(app.locator(".conn-dot.live")).toBeVisible();
      await hub.until(async () => (await hub.events(id)).length >= 12, "some events");
      const before = await hub.events(id);

      await hub.kill("SIGKILL");
      await expect(app.locator(".topbar .conn-dot.live")).toHaveCount(0);
      const restartMs = await hub.restart();
      info.annotations.push({ type: "restart-ms (inkl. Node-Start)", description: String(restartMs) });
      await expect(app.locator(".topbar .conn-dot.live")).toBeVisible({ timeout: 20_000 });

      const after = await hub.events(id);
      expect(after.slice(0, before.length).map((e) => [e.seq, e.type, e.summary])).toEqual(
        before.map((e) => [e.seq, e.type, e.summary]),
      );
      expect(after.map((e) => e.seq)).toEqual(after.map((_, i) => i + 1));
      const recovered = after.find((e) => e.payload.kind === "session.recovered");
      expect(recovered?.payload.controllable).toBe(true);

      await app.getByPlaceholder("Antworten…").fill("nach dem Neustart");
      await app.getByRole("button", { name: "Senden" }).click();
      await hub.until(async () => (await hub.events(id)).some((e) => e.summary === "steer: nach dem Neustart"), "steer after restart");
    });
  });

  test("eine gestoppte Session wird erst beim Öffnen geladen und läuft weiter", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Vor dem Neustart" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant"), "first answer");
    await hub.api(`/api/sessions/${id}/stop`, { body: {} });
    await hub.restart();
    const health = (await hub.api<{ sessions: { live: number } }>("/api/health")).body;
    expect(health.sessions.live, "stopped sessions are not loaded at startup").toBe(0);

    await app.reload();
    await openFromOverview(app, "opencode");
    await app.getByRole("button", { name: "Chat" }).click();
    await expect(app.getByText(/Antwort auf: Vor dem Neustart/)).toBeVisible();
    await app.getByPlaceholder("Antworten…").fill("Nach dem Neustart");
    await app.getByRole("button", { name: "Weiter" }).click();
    await expect(app.getByText(/Antwort auf: Nach dem Neustart .*\(fortgesetzt\)/)).toBeVisible();
  });

  test("ein OpenCode-Zug, der beim Kill lief, wird ehrlich als nicht steuerbar gemeldet", async ({ hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Arbeite LANGSAM" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "tool_use"), "turn running");
    await hub.restart();
    const recovered = (await hub.events(id)).find((e) => e.payload.kind === "session.recovered");
    expect(recovered?.payload.controllable).toBe(false);
    expect((await hub.api<{ controlMode: string }>(`/api/sessions/${id}`)).body.controlMode).toBe("observed");
  });

  test.fixme("AC-P5-3: ein überlebender Provider-Worker ist nach dem Kill wieder steuerbar (T5.6, kein recover() in claude/codex/opencode/copilot)", async () => {});
});
