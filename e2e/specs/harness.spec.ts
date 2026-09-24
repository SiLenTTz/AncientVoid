import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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

  test("T7.5: ein Beobachter hat keinen Steuerknopf — nur „Beobachtung beenden“", async ({ app, hub }) => {
    const dir = join(hub.root, "claude", "projects", hub.alpha.replace(/\//g, "-"));
    mkdirSync(dir, { recursive: true });
    const line = (o: object) => `${JSON.stringify({ sessionId: "extern-1", timestamp: new Date().toISOString(), ...o })}\n`;
    writeFileSync(join(dir, "extern-1.jsonl"), line({ type: "user", message: { role: "user", content: "Hallo" } }) + line({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Antwort von außerhalb" }] } }));
    const id = await hub.createSession({ adapter: "claude-clip" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.getByText("Antwort von außerhalb")).toBeVisible();
    await expect(app.getByText("nur beobachten — der Harness läuft außerhalb des Hubs")).toBeVisible();
    await expect(app.getByRole("button", { name: "Stop" })).toHaveCount(0);
    await expect(app.getByPlaceholder("Antworten…")).toHaveCount(0);
    await app.getByRole("button", { name: "Beobachtung beenden" }).click();
    await expect.poll(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status).toBe("stopped");
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
    // T7.9: the gatekeeper's label (rules only in this hub) — a hint, no decision.
    await expect(card.locator(".assessment")).toContainText("Laya: unauffällig");
    await expect(card.locator(".assessment")).toContainText("Regeln");
    await expect(app.locator(".topbar .pill")).toHaveAttribute("data-status", "waiting_approval");
    expect((await hub.events(id)).filter((e) => e.type === "tool_result")).toHaveLength(0);
    await card.getByRole("button", { name: "Erlauben" }).click();
    await expect(app.getByText(/Antwort auf: Bitte WERKZEUG · Claude .* · Ausgabe hallo-uacc/)).toBeVisible();
    await expect(card).toHaveCount(0);
    await app.getByRole("button", { name: "Verlauf" }).click();
    await expect(app.locator(".event.tool_use")).toHaveCount(1);
    await expect(app.locator(".event.tool_use")).toContainText("echo hallo-uacc");
    await hub.until(async () => (await hub.api<{ costUsd: number }>(`/api/sessions/${id}`)).body.costUsd > 0, "cost");
  });

  test("T7.9: ein Schlüssel ins Netz ist kritisch — die Karte verlangt den Passkey, das Tool läuft nicht", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "claude", prompt: "Bitte WERKZEUG GEFAHR" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    const card = app.locator(".session-approvals .approval-card");
    await expect(card.locator(".assessment")).toContainText("Laya: kritisch — Passkey");
    await expect(card.locator(".assessment")).toContainText("sendet nach außen");
    const [approval] = (await hub.api<{ class: string; assessment: { securityGate: string } }[]>("/api/approvals?status=pending")).body;
    expect(approval).toMatchObject({ class: "destructive", assessment: { securityGate: "CRITICAL_BLOCK" } });
    // A plain "approve" is not enough for a destructive approval (ADR-0007).
    const plain = await hub.api(`/api/approvals/${(approval as unknown as { id: string }).id}/decide`, { body: { decision: "approve", reason: "test" } });
    expect(plain.status).toBeGreaterThanOrEqual(400);
    expect((await hub.events(id)).filter((e) => e.type === "tool_result")).toHaveLength(0);
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
    await expect(app.locator(".topbar .pill")).toHaveAttribute("data-status", "idle");
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

test.describe("ACP-Harness (T7.2)", () => {
  test("ein ACP-Agent fragt vor dem Tool, „Erlauben“ gibt genau diesen Aufruf frei", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "acp", prompt: "Bitte WERKZEUG" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByRole("button", { name: "Chat" }).click();
    const card = app.locator(".session-approvals .approval-card");
    await expect(card.locator(".tool-input")).toHaveText("echo hallo-acp");
    await expect(app.locator(".topbar .pill")).toHaveAttribute("data-status", "waiting_approval");
    await card.getByRole("button", { name: "Erlauben" }).click();
    await expect(app.getByText(/Antwort auf: Bitte WERKZEUG · ACP · Ausgabe hallo-acp \(allow-once\)/)).toBeVisible();
    await expect(app.locator(".topbar .pill")).toHaveAttribute("data-status", "idle");
    await app.getByPlaceholder("Antworten…").fill("Noch eine Frage");
    await app.getByRole("button", { name: "Senden" }).click();
    await expect(app.getByText(/Antwort auf: Noch eine Frage · ACP/)).toBeVisible();
  });

  test.describe("mit tmux-Workern", () => {
    test.use({ hubOptions: { runner: "tmux" } });

    test("nach einem harten Hub-Absturz wird der ACP-Agent übernommen und nimmt weiter Prompts", async ({ app, hub }) => {
      const id = await hub.createSession({ adapter: "acp", prompt: "Erster Zug" });
      await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant"), "first answer");
      const pidBefore = (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status;
      expect(pidBefore).toBe("idle");
      await hub.restart();
      await hub.until(async () => (await hub.events(id)).some((e) => e.payload.kind === "session.recovered"), "recovered");
      await app.goto(`${hub.origin}/#/sessions/${id}`);
      await app.getByRole("button", { name: "Chat" }).click();
      await app.getByPlaceholder("Antworten…").fill("Nach dem Absturz");
      await app.getByRole("button", { name: "Senden" }).click();
      await expect(app.getByText(/Antwort auf: Nach dem Absturz · ACP/)).toBeVisible();
      const started = (await hub.events(id)).filter((e) => e.payload.kind === "acp.native_session");
      expect(started, "same agent session, no new one").toHaveLength(1);
    });
  });
});

test.describe("Codex app-server (T7.2)", () => {
  test("Modellkatalog aus model/list, Befehl fragt vorher, Kontingent sichtbar", async ({ app, hub }) => {
    await app.getByRole("button", { name: "Neue Session" }).click();
    await app.getByLabel("Adapter").selectOption("codex");
    await expect(app.getByLabel("Modell").locator("option")).toHaveText(["Standard des Harness", "GPT-6-Astra", "GPT-5.3-Codex"]);
    await app.getByLabel("Modell").selectOption("gpt-6-astra");
    await app.getByPlaceholder("Refactore den Auth-Flow…").fill("Bitte WERKZEUG");
    await app.getByRole("button", { name: "Starten" }).click();
    await app.getByRole("button", { name: "Chat" }).click();
    const card = app.locator(".session-approvals .approval-card");
    await expect(card.locator(".tool-input")).toHaveText("echo hallo-codex");
    await card.getByRole("button", { name: "Erlauben" }).click();
    await expect(app.getByText(/Antwort auf: Bitte WERKZEUG · Codex · Ausgabe hallo-codex \(accept\)/)).toBeVisible();
    await expect(app.locator(".topbar .pill")).toHaveAttribute("data-status", "idle");
    await app.goto(hub.origin);
    await app.getByRole("button", { name: "Status" }).click();
    // ADR-0004 Nachtrag: codex quota from account/rateLimits — 12 % of 5 h used
    await expect(app.locator(".provider-card").filter({ hasText: "codex" })).toContainText(/5 ?h[^0-9]*12/);
  });

  test("eine Codex-Rückfrage wird am Handy beantwortet", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "codex", prompt: "FRAGE" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByRole("button", { name: "Chat" }).click();
    const card = app.locator(".session-approvals .approval-card");
    await expect(card.locator(".question-text")).toHaveText("Welche Farbe?");
    await card.getByRole("button", { name: "Rot" }).click();
    await card.getByRole("button", { name: "Antworten" }).click();
    await expect(app.getByText(/Gewählt: Rot/)).toBeVisible();
  });
});

