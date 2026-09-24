import { test, expect, openFromOverview } from "../support/fixtures.ts";

test.describe("Hub-Neustart (AC-P5-3, K7, BUG-0018)", () => {
  test.describe("laufende Session", () => {
    test.use({ hubOptions: { dummyAutoStop: 0 } });

    test("harter Kill: bestätigte Events bleiben exakt, die Session bleibt steuerbar @desktop", async ({ app, hub }, info) => {
      const id = await hub.createSession({ adapter: "dummy" });
      await app.goto(`${hub.origin}/#/sessions/${id}`);
      await app.getByRole("button", { name: "Verlauf" }).click();
      await expect(app.locator(".session-topbar .conn-dot.live")).toBeVisible();
      await hub.until(async () => (await hub.events(id)).length >= 12, "some events");
      const before = await hub.events(id);

      await hub.kill("SIGKILL");
      await expect(app.locator(".session-topbar .conn-dot.live")).toHaveCount(0);
      const restartMs = await hub.restart();
      info.annotations.push({ type: "restart-ms (inkl. Node-Start)", description: String(restartMs) });
      await expect(app.locator(".session-topbar .conn-dot.live")).toBeVisible({ timeout: 20_000 });

      const after = await hub.events(id);
      expect(after.slice(0, before.length).map((e) => [e.seq, e.type, e.summary])).toEqual(
        before.map((e) => [e.seq, e.type, e.summary]),
      );
      expect(after.map((e) => e.seq)).toEqual(after.map((_, i) => i + 1));
      const recovered = after.find((e) => e.payload.kind === "session.recovered");
      expect(recovered?.payload.controllable).toBe(true);

      await app.getByPlaceholder("Antworten…").fill("nach dem Neustart");
      await app.getByRole("button", { name: "Senden" }).click();
      await hub.until(async () => (await hub.events(id)).some((e) => e.type === "user" && e.payload.text === "nach dem Neustart"), "steer after restart");
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
    await expect(app.locator(".tail-scroll").getByText(/Antwort auf: Vor dem Neustart/)).toBeVisible();
    await app.getByPlaceholder("Antworten…").fill("Nach dem Neustart");
    await app.getByRole("button", { name: "Weiter" }).click();
    await expect(app.locator(".tail-scroll").getByText(/Antwort auf: Nach dem Neustart .*\(fortgesetzt\)/)).toBeVisible();
  });

  test("ohne tmux stoppt ein geplanter Neustart die Sessions, verliert aber keine Arbeit (BUG-0027)", async ({ hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Lege eine DATEI an" });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "turn over");
    const workdir = String((await hub.events(id)).find((e) => e.payload.kind === "session.created")?.payload.workdir);
    await hub.restart("SIGTERM");
    expect((await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status).toBe("stopped");
    const { existsSync } = await import("node:fs");
    expect(existsSync(`${workdir}/e2e-change.txt`)).toBe(true);
  });

  test("nach einem Kill zwischen zwei Zügen geht es mit derselben Provider-Session weiter (T5.6)", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Vor dem Kill" });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "turn over");
    const native = (await hub.api<{ nativeSessionId: string }>(`/api/sessions/${id}`)).body.nativeSessionId;
    await hub.restart("SIGKILL");
    const recovered = (await hub.events(id)).find((e) => e.payload.kind === "session.recovered");
    expect(recovered?.payload.controllable).toBe(true);

    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.locator(".topbar .pill")).toHaveAttribute("data-status", "idle");
    await app.getByRole("button", { name: "Chat" }).click();
    await app.getByPlaceholder("Antworten…").fill("Nach dem Kill");
    await app.getByRole("button", { name: "Senden" }).click();
    await expect(app.getByText(new RegExp(`Antwort auf: Nach dem Kill · Session ${native} \\(fortgesetzt\\)`))).toBeVisible();
  });

  test.describe("mit tmux-Worker", () => {
    test.use({ hubOptions: { runner: "tmux" } });

    test("ein geplanter Neustart stoppt nichts: der Zug läuft weiter, die Arbeit bleibt @desktop", async ({ app, hub }) => {
      const id = await hub.createSession({ adapter: "opencode", prompt: "Lege eine DATEI an WARTE3" });
      await hub.until(async () => (await hub.events(id)).some((e) => e.type === "tool_use"), "turn running");
      const workdir = String((await hub.events(id)).find((e) => e.payload.kind === "session.created")?.payload.workdir);
      await hub.restart("SIGTERM");

      await app.goto(`${hub.origin}/#/sessions/${id}`);
      await app.getByRole("button", { name: "Chat" }).click();
      await expect(app.locator(".tail-scroll").getByText(/Antwort auf: Lege eine DATEI an WARTE3/)).toBeVisible({ timeout: 15_000 });
      await expect(app.locator(".topbar .pill")).toHaveAttribute("data-status", "idle");
      const events = await hub.events(id);
      expect(events.some((e) => e.payload.kind === "session.stopped"), "planned restart stops nothing").toBe(false);
      const { existsSync } = await import("node:fs");
      expect(existsSync(`${workdir}/e2e-change.txt`)).toBe(true);

      await app.getByPlaceholder("Antworten…").fill("Nach dem Neustart");
      await app.getByRole("button", { name: "Senden" }).click();
      await expect(app.locator(".tail-scroll").getByText(/Antwort auf: Nach dem Neustart .*\(fortgesetzt\)/)).toBeVisible();
    });

    test("ein Zug, der den Kill überlebt, wird übernommen und läuft sichtbar zu Ende (AC-P5-3) @desktop", async ({ app, hub }) => {
      const id = await hub.createSession({ adapter: "opencode", prompt: "Arbeite WARTE3" });
      await hub.until(async () => (await hub.events(id)).some((e) => e.type === "tool_use"), "turn running");
      const before = await hub.events(id);
      await hub.restart("SIGKILL");

      await app.goto(`${hub.origin}/#/sessions/${id}`);
      await app.getByRole("button", { name: "Chat" }).click();
      await expect(app.locator(".tail-scroll").getByText(/Antwort auf: Arbeite WARTE3/)).toBeVisible({ timeout: 15_000 });
      await expect(app.locator(".topbar .pill")).toHaveAttribute("data-status", "idle");

      const after = await hub.events(id);
      expect(after.slice(0, before.length).map((e) => e.summary)).toEqual(before.map((e) => e.summary));
      expect(after.filter((e) => e.type === "tool_use"), "no replayed output").toHaveLength(1);
      expect(after.find((e) => e.payload.kind === "session.recovered")?.payload.controllable).toBe(true);

      await app.getByPlaceholder("Antworten…").fill("Und weiter");
      await app.getByRole("button", { name: "Senden" }).click();
      await expect(app.locator(".tail-scroll").getByText(/Antwort auf: Und weiter .*\(fortgesetzt\)/)).toBeVisible();
    });
  });
});
