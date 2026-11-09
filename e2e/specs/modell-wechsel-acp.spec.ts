import { test, expect } from "../support/fixtures.ts";

/**
 * ADR-0061: Modellwechsel in der laufenden Session für ACP-Harnesses (maki, omp, opencode, dsh — hier die
 * ACP-Attrappe `e2e/support/bin/acp-agent`). Bewiesen wird an der Antwort des nächsten Zugs, auf welchem
 * Modell der Agent wirklich lief.
 */
test.describe("Modellwechsel bei ACP-Harnesses", () => {
  test("Dropdown in der Session: der nächste Zug läuft auf dem gewählten Modell", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "acp", prompt: "Hallo" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant"), "erste Antwort");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByLabel("Modell").selectOption("lokal/klein");
    await expect(app.getByLabel("Modell")).toHaveValue("lokal/klein");
    await hub.until(async () => (await hub.events(id)).some((e) => (e.payload as { kind?: string }).kind === "acp.model"), "Modell-Event");

    await app.getByPlaceholder("Antworten…").fill("Noch eine Frage");
    await app.getByRole("button", { name: "Senden" }).click();
    await expect(app.locator(".tail-scroll").getByText(/Antwort auf: Noch eine Frage.*Modell \["lokal","klein"\]/)).toBeVisible();
  });

  test("ein nicht angebotenes Modell wird sichtbar abgelehnt und nicht eingetragen", async ({ hub }) => {
    const id = await hub.createSession({ adapter: "acp", prompt: "Hallo" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant"), "erste Antwort");
    const res = await hub.api<{ error?: string; detail?: string }>(`/api/sessions/${id}/steer`, { body: { kind: "configure", model: "gibts/nicht" } });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(res.body)).toContain("gibts/nicht");
    expect((await hub.api<{ model: string | null }>(`/api/sessions/${id}`)).body.model).not.toBe("gibts/nicht");
    expect((await hub.events(id)).some((e) => (e.payload as { kind?: string }).kind === "acp.model_unavailable")).toBe(true);
  });
});
