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

test.describe("Claude im Browser (T7.8, AI-P5-3)", () => {
  test("T7.2: Claude fragt vor dem Tool — erst nach „Erlauben“ läuft es, mit Kosten", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "claude", prompt: "Bitte WERKZEUG" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByRole("button", { name: "Chat" }).click();
    const card = app.locator(".session-approvals .approval-card");
    await expect(card).toContainText("Bash");
    await expect(card.locator(".tool-input")).toHaveText("echo hallo-uacc");
    await expect(app.locator(".topbar .pill")).toHaveText("waiting_approval");
    expect((await hub.events(id)).filter((e) => e.type === "tool_result")).toHaveLength(0);
    await card.getByRole("button", { name: "Erlauben" }).click();
    await expect(app.getByText(/Antwort auf: Bitte WERKZEUG · Claude .* · Ausgabe hallo-uacc/)).toBeVisible();
    await expect(card).toHaveCount(0);
    await app.getByRole("button", { name: "Verlauf" }).click();
    await expect(app.locator(".event.tool_use")).toHaveCount(1);
    await expect(app.locator(".event.tool_use")).toContainText("echo hallo-uacc");
    await hub.until(async () => (await hub.api<{ costUsd: number }>(`/api/sessions/${id}`)).body.costUsd > 0, "cost");
  });

  test("ein Claude-Fehler kommt als lesbare Meldung, der nächste Prompt läuft wieder (ADR-0015)", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "claude", prompt: "Bitte FEHLER" });
    const toast = app.locator(".toast.error").filter({ hasText: "Serverfehler beim Provider" });
    await expect(toast).toBeVisible();
    await expect(toast).toContainText("überlastet");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByRole("button", { name: "Chat" }).click();
    await expect(app.locator(".event.provider-error")).toContainText("claude: Serverfehler beim Provider");
    await app.getByPlaceholder("Antworten…").fill("Jetzt wieder");
    await app.getByRole("button", { name: /^(Senden|Weiter)$/ }).click();
    await expect(app.getByText(/Antwort auf: Jetzt wieder · Claude/)).toBeVisible();
  });

  test("T7.2: „Ablehnen“ — das Tool läuft nicht, Claude erfährt wer und warum", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "claude", prompt: "Bitte WERKZEUG" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByRole("button", { name: "Chat" }).click();
    await app.locator(".session-approvals .approval-card").getByRole("button", { name: "Ablehnen" }).click();
    await expect(app.getByText(/nicht ausgeführt: Abgelehnt von e2e\. Nicht ausführen\./)).toBeVisible();
    const results = (await hub.events(id)).filter((e) => e.type === "tool_result");
    expect(results).toHaveLength(1);
    expect(results[0]!.payload.isError).toBe(true);
  });

  test("T7.2: eine Rückfrage von Claude am Handy beantworten", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "claude", prompt: "Bitte FRAGE" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByRole("button", { name: "Chat" }).click();
    const card = app.locator(".session-approvals .approval-card");
    await expect(card.locator(".question-text")).toHaveText("Welche Farbe soll das Logo haben?");
    await expect(card.getByRole("button", { name: "Antworten" })).toBeDisabled();
    await card.getByRole("button", { name: "Grün" }).click();
    await card.getByRole("button", { name: "Antworten" }).click();
    await expect(app.getByText(/Antwort auf: Bitte FRAGE · Claude .* · Gewählt: Grün/)).toBeVisible();
  });

  test("T7.2: die Tool-Anfrage steht auch in der Freigabe-Warteschlange", async ({ app, hub }) => {
    await hub.createSession({ adapter: "claude", prompt: "Bitte WERKZEUG" });
    await app.getByRole("button", { name: /1 Freigabe wartet auf dich/ }).click();
    const card = app.locator(".approval-card").filter({ hasText: "echo hallo-uacc" });
    await card.getByRole("button", { name: "Erlauben" }).click();
    await expect(app.getByText("keine offenen Freigaben")).toBeVisible();
  });
});
