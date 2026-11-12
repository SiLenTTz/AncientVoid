import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, openApprovals, sessionTab } from "../support/fixtures.ts";

test.describe("Harness-Parität (EPIC-P7)", () => {
  test("T7.1: Modell aus dem Katalog des Harness wählen, nur wo der Harness eines nimmt", async ({ app, hub }) => {
    await app.getByRole("button", { name: "Neue Session" }).click();
    await app.getByLabel("Adapter").selectOption("dummy");
    await expect(app.getByLabel("Modell")).toHaveCount(0);

    await app.getByLabel("Adapter").selectOption("opencode");
    const model = app.getByLabel("Modell");
    await expect(model.locator("option")).toHaveText(["Standard des Harness", "e2e/fake-model (Standard)", "opencode/big-pickle", "zai-coding-plan/glm-5.3"]);
    // the registration's default arrives preselected — what "Standard" runs
    await expect(model).toHaveValue("e2e/fake-model");
    await model.selectOption("opencode/big-pickle");
    await app.getByPlaceholder("Refactore den Auth-Flow…").fill("Hallo");
    await app.getByRole("button", { name: "Starten" }).click();
    await expect(app.locator(".session-topbar")).toContainText("opencode · opencode/big-pickle");
    const id = decodeURIComponent(app.url().split("#/sessions/")[1]!);
    expect((await hub.api<{ model: string | null }>(`/api/sessions/${id}`)).body.model).toBe("opencode/big-pickle");
  });

  test("cursor-agent: Antwort kommt im Chat an, Modellkatalog füllt das Startformular", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "cursor", prompt: "Hallo" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByRole("button", { name: "Chat" }).click();
    await expect(app.locator(".tail-scroll").getByText(/Antwort auf: Hallo · cursor/)).toBeVisible();
    await expect(app.locator(".run-strip .run-tokens")).toContainText("Σ 1.542 Tokens");
    // native Fortsetzung: Follow-up läuft auf derselben chatId
    await app.getByPlaceholder("Antworten…").fill("Nochmal");
    await app.getByRole("button", { name: "Senden" }).click();
    await expect(app.locator(".tail-scroll").getByText(/Antwort auf: Nochmal · cursor \(fortgesetzt\)/)).toBeVisible();
    // Katalog im Startformular
    await app.getByRole("button", { name: "Zur Übersicht" }).click();
    await app.getByRole("button", { name: "Neue Session" }).click();
    await app.getByLabel("Adapter").selectOption("cursor");
    const model = app.getByLabel("Modell");
    await expect(model).toHaveValue("auto");
    await expect(model.locator("option")).toHaveText(["Standard des Harness", "Auto (default) (Standard)", "Claude Sonnet 5", "Codex 5.3"]);
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

  test("eingeklappte Steuerung behält „Beobachtung beenden“", async ({ app, hub }) => {
    await app.setViewportSize({ width: 800, height: 420 });
    const dir = join(hub.root, "claude", "projects", hub.alpha.replace(/\//g, "-"));
    mkdirSync(dir, { recursive: true });
    const line = (o: object) => `${JSON.stringify({ sessionId: "extern-2", timestamp: new Date().toISOString(), ...o })}\n`;
    writeFileSync(join(dir, "extern-2.jsonl"), line({ type: "user", message: { role: "user", content: "Hallo" } }) + line({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Antwort von außerhalb" }] } }));
    const id = await hub.createSession({ adapter: "claude-clip" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.getByLabel("Steuerung einblenden")).toBeVisible();
    await expect(app.getByText("nur beobachten — der Harness läuft außerhalb des Hubs")).toBeVisible();
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
    await expect(card.locator(".tool-input")).toHaveText("echo hallo-ancientvoid");
    // T7.9: the gatekeeper's label (rules only in this hub) — a hint, no decision.
    await expect(card.locator(".assessment")).toContainText("Laya: unauffällig");
    await expect(card.locator(".assessment")).toContainText("Regeln");
    await expect(app.locator(".topbar .status")).toHaveAttribute("data-status", "waiting_approval");
    expect((await hub.events(id)).filter((e) => e.type === "tool_result")).toHaveLength(0);
    await card.getByRole("button", { name: "Erlauben" }).click();
    await expect(app.locator(".tail-scroll").getByText(/Antwort auf: Bitte WERKZEUG · Claude .* · Ausgabe hallo-ancientvoid/)).toBeVisible();
    await expect(card).toHaveCount(0);
    await sessionTab(app, "Verlauf");
    await expect(app.locator(".event.tool_use")).toHaveCount(1);
    await expect(app.locator(".event.tool_use")).toContainText("echo hallo-ancientvoid");
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
    await expect(app.locator(".tail-scroll").getByText(/Antwort auf: Jetzt wieder · Claude/)).toBeVisible();
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
    await expect(app.locator(".topbar .status")).toHaveAttribute("data-status", "idle");
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
    await expect(app.locator(".tail-scroll").getByText(/Antwort auf: Bitte FRAGE · Claude .* · Gewählt: Grün/)).toBeVisible();
  });

  test("AC-P21-4: eine offene Frage überlebt einen Reload, danach erreicht die Antwort den Harness", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "claude", prompt: "Bitte FRAGE" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByRole("button", { name: "Chat" }).click();
    await expect(app.locator(".session-approvals .approval-card .question-text")).toHaveText("Welche Farbe soll das Logo haben?");
    await app.reload();
    await app.getByRole("button", { name: "Chat" }).click();
    const card = app.locator(".session-approvals .approval-card");
    await expect(card.locator(".question-text")).toHaveText("Welche Farbe soll das Logo haben?");
    await card.getByRole("button", { name: "Grün" }).click();
    await card.getByRole("button", { name: "Antworten" }).click();
    await expect(app.locator(".tail-scroll").getByText(/Antwort auf: Bitte FRAGE · Claude .* · Gewählt: Grün/)).toBeVisible();
  });

  test("T21.4: ein ACP-Formular (elicitation) wird zum Fragen-Dialog, die Antwort passt zum Schema", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "acp", prompt: "Bitte FRAGE" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByRole("button", { name: "Chat" }).click();
    const card = app.locator(".session-approvals .approval-card");
    await expect(card.locator(".question-text")).toHaveText(["Strategie", "Teile", "Sicher?", "Anzahl"]);
    await expect(card.locator(".question-header").first()).toHaveText("Wie soll es weitergehen?");
    await expect(card.locator(".question-progress")).toHaveText("0 von 4 beantwortet");
    await expect(card.getByRole("button", { name: "Antworten" })).toBeDisabled();

    const pick = (question: string, label: RegExp) => card.locator(".question").filter({ hasText: question }).locator(".choice-label", { hasText: label }).click();
    await pick("Strategie", /^Gründlich$/);
    await pick("Teile", /^ui$/);
    await pick("Teile", /^doku$/);
    await pick("Sicher?", /^Ja$/);
    // Ziffern-Taste wählt, Eigene Antwort ersetzt die Wahl, Enter sendet.
    await card.locator(".question").filter({ hasText: "Anzahl" }).locator(".question-free").fill("3");
    await expect(card.locator(".question-progress")).toHaveText("4 von 4 beantwortet");
    await expect(card.locator(".question-summary")).toContainText("Teile → ui, doku");
    await card.locator(".question").filter({ hasText: "Anzahl" }).locator(".question-free").press("Enter");
    await expect(app.locator(".tail-scroll").getByText(/"content":\{"strategie":"gruendlich","teile":\["ui","doku"\],"sicher":true,"anzahl":3\}/)).toBeVisible();
  });

  test("T21.2: Rate-Limit wird erkannt, die Arbeit geht mit einem Tipp an einen anderen Provider", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "acp", prompt: "Baue die Suche um FEHLER" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByRole("button", { name: "Chat" }).click();
    const bar = app.locator(".handover-bar");
    await expect(bar).toContainText("Rate-Limit des Providers");
    await bar.getByRole("button", { name: /An andere Session übergeben/ }).click();

    // Ohne Zielwahl startet nichts; der Text ist sichtbar und änderbar.
    await expect(bar.getByRole("button", { name: "Übergeben", exact: true })).toBeDisabled();
    const text = bar.getByLabel("Übergabetext");
    await expect(text).toHaveValue(/Grund: Rate-Limit des Providers/);
    await expect(text).toHaveValue(/Ursprünglicher Auftrag:\nBaue die Suche um FEHLER/);
    // Der Text ist änderbar — gesendet wird, was dasteht.
    await text.fill("Mach mit der Suche weiter, die Tests fehlen noch.");
    await bar.getByLabel("Ziel-Provider").selectOption("opencode");
    await bar.getByRole("button", { name: "Übergeben", exact: true }).click();

    await expect(app).toHaveURL(new RegExp(`#/sessions/(?!${id})`));
    await sessionTab(app, "Verlauf");
    await expect(app.locator(".tail-scroll")).toContainText("Übernommen von acp");
    await app.getByRole("button", { name: "Chat" }).click();
    await expect(app.locator(".tail-scroll").getByText(/Antwort auf: Mach mit der Suche weiter, die Tests fehlen noch\./)).toBeVisible();

    // Die Ausgangssession zeigt, wohin die Arbeit ging, und das Banner verschwindet.
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await sessionTab(app, "Verlauf");
    await expect(app.locator(".tail-scroll")).toContainText("Übergeben an opencode");
    await expect(app.locator(".handover-bar")).toHaveCount(0);
  });

  test("BUG-0123: verlorene Provider-Session — hier weitermachen baut den Kontext in derselben Session neu auf", async ({ app, hub }) => {
    // Adoption einer native ID, die der Agent nicht mehr kennt: der Adapter
    // meldet den Kontextverlust sichtbar, die Session klemmt nicht (idle).
    const id = await hub.createSession({ adapter: "acp", adoptNativeSessionId: "acp_lost_e2e" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    // promptlos: die Züge-Chat-Ansicht ist leer — der Verlust steht im Verlauf
    await sessionTab(app, "Verlauf");
    await expect(app.locator(".tail-scroll")).toContainText("beim Agenten nicht mehr vorhanden — neuer Kontext");

    const bar = app.locator(".handover-bar");
    await expect(bar).toContainText("Agent hat den Verlauf verloren");
    await bar.getByRole("button", { name: /Hier weitermachen/ }).click();

    // Der Übergabetext läuft als Zug in DIESER Session — mit Antwort.
    await expect(app.locator(".tail-scroll").getByText(/Antwort auf: .*git status/)).toBeVisible();
    await expect(app.locator(".handover-bar")).toHaveCount(0);
  });

  test("T21.2: der Übergabetext lässt sich auf Klick vom Ziel-Modell straffen und wieder zurücknehmen", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "acp", prompt: "Baue die Suche um FEHLER" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByRole("button", { name: "Chat" }).click();
    const bar = app.locator(".handover-bar");
    await bar.getByRole("button", { name: /An andere Session übergeben/ }).click();
    const tighten = bar.getByRole("button", { name: "Mit Modell straffen" });
    await expect(tighten).toBeDisabled();
    await bar.getByLabel("Ziel-Provider").selectOption("opencode");
    const text = bar.getByLabel("Übergabetext");
    await text.fill("mach die suche schneller");
    await tighten.click();
    await expect(text).toHaveValue(/^Ziel: mach die suche schneller\nScope:/);
    await bar.getByRole("button", { name: "Rückgängig" }).click();
    await expect(text).toHaveValue("mach die suche schneller");
  });

  test("T7.2: die Tool-Anfrage steht auch in der Freigabe-Warteschlange", async ({ app, hub }) => {
    await hub.createSession({ adapter: "claude", prompt: "Bitte WERKZEUG" });
    await openApprovals(app);
    const card = app.locator(".approval-card").filter({ hasText: "echo hallo-ancientvoid" });
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
    await expect(app.locator(".topbar .status")).toHaveAttribute("data-status", "waiting_approval");
    await card.getByRole("button", { name: "Erlauben" }).click();
    await expect(app.locator(".tail-scroll").getByText(/Antwort auf: Bitte WERKZEUG · ACP · Ausgabe hallo-acp \(allow-once\)/)).toBeVisible();
    await expect(app.locator(".topbar .status")).toHaveAttribute("data-status", "idle");
    // ADR-0032: token sums and the context window percentage, both live.
    await expect(app.locator(".run-strip .run-tokens")).toHaveText("Σ 42 Tokens · Kontext 15 % · frei 170 von 200");
    await expect(app.locator(".tail-scroll .turn-stats").first()).toContainText("42 Tokens");
    await expect(app.locator(".tail-scroll .turn-stats").first()).toContainText("Kontext 30");
    await app.getByPlaceholder("Antworten…").fill("Noch eine Frage");
    await app.getByRole("button", { name: "Senden" }).click();
    await expect(app.locator(".tail-scroll").getByText(/Antwort auf: Noch eine Frage · ACP/)).toBeVisible();
    await expect(app.locator(".tail-scroll .turn-stats")).toHaveCount(2);
  });

  test("das Kontextfenster folgt dem gewählten Modell (ADR-0032)", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "acp", prompt: "Hallo", model: "lokal/glm-5.3" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "turn over");
    // glm-5.3 hat ein kuratiertes Fenster von 1.000.000 Tokens — nicht die
    // statische Adapter-Zahl (200 aus der E2E-Konfiguration).
    await expect(app.locator(".run-strip .run-tokens")).toHaveText("Σ 42 Tokens · Kontext 0 % · frei 999.970 von 1.000.000");
  });

  test("Startformular: Modellkatalog als Dropdown, konfigurierter Default vorausgewählt (Factory-Muster)", async ({ app, hub }) => {
    await app.goto(`${hub.origin}/#/`);
    await app.getByRole("button", { name: "Neue Session" }).click();
    await app.getByLabel("Adapter").selectOption("acp");
    const select = app.getByLabel("Modell");
    await expect(select).toHaveValue("lokal/klein");
    await expect(select.locator("option")).toHaveText(["Standard des Harness", "cloud/gross", "lokal/klein (Standard)"]);
    // Vorauswahl ist echt: eine Session ohne eigene Wahl läuft auf dem Default.
    await app.getByPlaceholder("Refactore den Auth-Flow…").fill("Hallo");
    await app.getByRole("button", { name: "Starten" }).click();
    // the topbar names the adapter id and the session's model — the
    // preselected default, since the form sent no other choice.
    await expect(app.locator(".session-topbar")).toContainText("acp · lokal/klein");
    await expect(app.locator(".tail-scroll").getByText(/Antwort auf: Hallo · ACP · Modell \["lokal","klein"\]/)).toBeVisible();
  });

  test("eine Eingabe während eines laufenden Zugs wartet sichtbar und wird zugestellt (BUG-0033 + FIFO)", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "acp", prompt: "Arbeite LANGSAM" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByRole("button", { name: "Chat" }).click();
    // Die UI bietet während des Zugs nur Vormerken an; der Adapter-Pfad (BUG-0033) wird direkt über die Steer-Route geprüft.
    await expect(app.getByRole("button", { name: "Senden" })).toHaveCount(0);
    await hub.api(`/api/sessions/${id}/steer`, { body: { kind: "prompt", text: "Zwischendurch!" } });
    // The turn still runs — the message is queued, visibly in the chat.
    await expect(app.locator(".tail-scroll").getByText(/wartet bis der Zug endet/)).toBeVisible();
    await app.getByRole("button", { name: "Stop" }).click();
    await expect(app.locator(".topbar .status")).toHaveAttribute("data-status", "stopped");
    const queued = (await hub.events(id)).filter((e) => e.payload.kind === "acp.queued");
    expect(queued).toHaveLength(1);
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
      await expect(app.locator(".tail-scroll").getByText(/Antwort auf: Nach dem Absturz · ACP/)).toBeVisible();
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
    await expect(app.locator(".tail-scroll").getByText(/Antwort auf: Bitte WERKZEUG · Codex · Ausgabe hallo-codex \(accept\)/)).toBeVisible();
    await expect(app.locator(".topbar .status")).toHaveAttribute("data-status", "idle");
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


test.describe("pi im Browser (BUG-0065)", () => {
  test("der Verlauf zeigt Thinking, Tool-Aufruf, Tool-Ergebnis und Antwort", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "pi", prompt: "Wie viele Zeilen hat notiz.txt?" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByRole("button", { name: "Chat" }).click();
    await expect(app.locator(".tail-scroll").getByText("Antwort auf: Wie viele Zeilen hat notiz.txt? · pi · notiz.txt hat 2 Zeilen.")).toBeVisible();
    await sessionTab(app, "Verlauf");
    await expect(app.locator(".event.thinking")).toHaveCount(2);
    await expect(app.locator(".event.thinking").first()).toContainText("Erst die Datei notiz.txt lesen.");
    await expect(app.locator(".event.tool_use")).toContainText("read");
    await expect(app.locator(".event.tool_use")).toContainText("notiz.txt");
    await expect(app.locator(".event.tool_result")).toContainText("alpha");
  });
});

test.describe("Lange Antworten im Chat (BUG-0068)", () => {
  test("eine Antwort über 4 KB steht vollständig im Chat", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "pi", prompt: "Bitte LANG" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant" && e.payload.truncated === true), "offloaded answer");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByRole("button", { name: "Chat" }).click();
    const answer = app.locator(".event.assistant").last();
    await expect(answer.locator(".summary")).toContainText("ENDE-DER-ANTWORT");
    await expect(answer.locator(".full-text-note")).toHaveCount(0);
  });
});

test.describe("Markdown im Chat (BUG-0067)", () => {
  test("Antworten erscheinen formatiert, HTML und javascript-Links bleiben Text", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "pi", prompt: "Bitte MARKDOWN" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByRole("button", { name: "Chat" }).click();
    const answer = app.locator(".event.assistant").last().locator(".markdown");
    await expect(answer.getByRole("heading", { name: "Stand" })).toBeVisible();
    await expect(answer.locator("li strong")).toHaveText("Fix:");
    await expect(answer.locator("table td code")).toHaveText("43f43d0");
    await expect(answer.locator("pre code")).toHaveText("**nicht fett**");
    await expect(answer).toContainText("<img src=x onerror=alert(1)>");
    await expect(answer.locator("img")).toHaveCount(0);
    await expect(answer.locator('a[href^="javascript"]')).toHaveCount(0);
    await expect(answer).not.toContainText("## Stand");
  });
});

test.describe("Tokens und Kontext je Session (ADR-0032)", () => {
  test("pi: verbrauchte Tokens und freier Kontext stehen im Kopf der Session", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "pi", prompt: "Wie viele Zeilen?" });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "turn over");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    // Stand-in: two replies, 1.092 + 1.132 tokens; fill 53 + 1.057 cached.
    await expect(app.locator(".run-strip .run-tokens")).toHaveText("Σ 2.224 Tokens · Kontext 1 % · frei 129.962 von 131.072");
  });

  // EPIC-P43 T43.4 (Kleinkram-Regel 1): Unbekanntes schweigt in der Statuszeile und steht im Bericht.
  test("ohne Meldung des Providers schweigt die Statuszeile zum Kontext, der Bericht sagt es ausdrücklich", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.locator(".run-strip")).not.toContainText("Kontext");
    await sessionTab(app, "Bericht");
    await expect(app.locator(".kv-row").filter({ hasText: "Kontextfenster" })).toContainText("keine Meldung");
  });
});
