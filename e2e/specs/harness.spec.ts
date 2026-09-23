import { test, expect } from "../support/fixtures.ts";

test.describe("Harness-Parität (EPIC-P7)", () => {
  test("T7.1: Modell aus dem Katalog des Harness wählen, nur wo der Harness eines nimmt", async ({ app, hub }) => {
    await app.getByRole("button", { name: "Neue Session" }).click();
    await app.getByLabel("Adapter").selectOption("dummy");
    await expect(app.getByLabel("Modell")).toHaveCount(0);

    await app.getByLabel("Adapter").selectOption("opencode");
    const model = app.getByLabel("Modell");
    await expect(model.locator("option")).toHaveText(["Standard des Harness", "e2e/fake-model", "opencode/big-pickle", "zai-coding-plan/glm-5.3"]);
    await model.selectOption("opencode/big-pickle");
    await app.getByPlaceholder("Refactore den Auth-Flow…").fill("Hallo");
    await app.getByRole("button", { name: "Starten" }).click();
    await expect(app.locator(".topbar")).toContainText("opencode · opencode/big-pickle");
    const id = decodeURIComponent(app.url().split("#/sessions/")[1]!);
    expect((await hub.api<{ model: string | null }>(`/api/sessions/${id}`)).body.model).toBe("opencode/big-pickle");
  });

  test("T7.1: der Server lehnt ab, was der Harness nicht kann — mit Grund", async ({ hub }) => {
    const res = await hub.api<{ error: string }>("/api/sessions", { body: { adapter: "dummy", project: hub.alpha, model: "gpt" } });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("dummy kann beim Start kein Modell wählen.");
    expect(await hub.sessions()).toHaveLength(0);
  });
});
