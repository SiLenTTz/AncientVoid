import { test, expect } from "../support/fixtures.ts";

test("Status zeigt Hub, Checkout und gebaute Oberfläche getrennt @desktop", async ({ app, hub }) => {
  const health = (await hub.api<{ deployment: { runtimeSha: string; checkoutSha: string; pwaSha: string } }>("/api/health")).body;
  expect(health.deployment.runtimeSha).toMatch(/^[a-f0-9]{40}$/);
  expect(health.deployment.pwaSha).toMatch(/^[a-f0-9]{40}$/);
  await app.goto(`${hub.origin}/#/status`);
  const card = app.getByRole("region", { name: "Ausgelieferter Stand" });
  await expect(card).toContainText(`Hub: ${health.deployment.runtimeSha.slice(0, 8)}`);
  await expect(card).toContainText(`PWA: ${health.deployment.pwaSha.slice(0, 8)}`);
});

test("Hintergrundarbeit bleibt bis zum letzten Job aktiv @desktop", async ({ app, hub }) => {
  const id = await hub.createSession({ adapter: "codex", prompt: "Ein kurzer Auftrag" });
  await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "main turn ended");
  const activity = async (job: string, state: string) => {
    const response = await hub.api(`/api/sessions/${id}/activity`, { body: { id: job, kind: "job", state } });
    expect(response.status).toBe(200);
  };
  await activity("gate", "running");
  await activity("watcher", "running");
  await app.goto(`${hub.origin}/#/sessions/${id}`);
  await expect(app.getByText("Hintergrundarbeit aktiv · 2 offene Aktivitäten")).toBeVisible();
  await activity("gate", "completed");
  expect((await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status).toBe("working");
  await expect(app.getByText("Hintergrundarbeit aktiv · 1 offene Aktivität", { exact: true })).toBeVisible();
  await activity("watcher", "completed");
  await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "last job ended");
});

test("Abgelehnter Codex-Auftrag zeigt Fehler und lässt sich abbrechen @desktop", async ({ app, hub }) => {
  const id = await hub.createSession({ adapter: "codex", prompt: "Erster Auftrag" });
  await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "initial turn ended");
  const ack = await hub.api<{ ok: boolean }>(`/api/sessions/${id}/steer`, { body: { kind: "prompt", text: "REJECT_START" } });
  expect(ack.status).toBe(422);
  expect(ack.body.ok).toBe(false);
  await app.goto(`${hub.origin}/#/sessions/${id}`);
  const banner = app.getByRole("status", { name: "Session benötigt Entscheidung" });
  await expect(banner).toBeVisible();
  await expect(banner.getByRole("button", { name: "An andere Session übergeben…" })).toBeEnabled();
  await banner.getByRole("button", { name: "Abbrechen", exact: true }).click();
  await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "stopped", "user stopped");
});

test.describe("Automatische Wiederaufnahme scheitert sichtbar", () => {
  test.use({ hubOptions: { dummyAutoStop: 0, interruptedDummy: { resume: true, auto: true, failResume: true } } });
  test("nach technischem Abbruch kann die Aufgabe übergeben werden @desktop", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy", prompt: "Fortzusetzende Aufgabe" });
    await hub.api(`/api/sessions/${id}/steer`, { body: { kind: "prompt", text: "P27: worker transport lost" } });
    await hub.until(async () => (await hub.events(id)).some(e => e.payload.kind === "session.recovery_blocked"), "failed automatic resume recorded");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    const banner = app.getByRole("status", { name: "Session benötigt Entscheidung" });
    await expect(banner).toContainText("Wiederaufnahme fehlgeschlagen");
    await banner.getByRole("button", { name: "An andere Session übergeben…" }).click();
    await app.getByLabel("Ziel-Provider").selectOption("codex");
    await expect(app.getByLabel("Übergabetext")).not.toHaveValue("");
    await app.locator(".handover-form").getByRole("button", { name: "Übergeben", exact: true }).click();
    await hub.until(async () => (await hub.events(id)).some(e => e.payload.kind === "session.handover_out"), "handover recorded");
    await expect(app).not.toHaveURL(new RegExp(id));
  });
});
