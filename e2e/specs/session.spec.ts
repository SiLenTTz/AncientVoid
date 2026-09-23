import { test, expect, statusPill } from "../support/fixtures.ts";

test.describe("Session anlegen und verfolgen (P1, P1.6)", () => {
  test("eine neue Session startet aus der UI und öffnet sich per Link @desktop", async ({ app, hub }) => {
    await app.getByRole("button", { name: "Neue Session" }).click();
    await app.getByLabel("Adapter").selectOption("opencode");
    await expect(app.getByLabel("Projekt")).toContainText("alpha (main)");
    await expect(app.getByLabel("Projekt")).toContainText("beta (main)");
    await app.getByPlaceholder("Refactore den Auth-Flow…").fill("Fasse die README zusammen");
    await app.getByRole("button", { name: "Starten" }).click();

    await expect(app).toHaveURL(/#\/sessions\//);
    const id = decodeURIComponent(app.url().split("#/sessions/")[1]!);
    await expect(app.locator(".topbar")).toContainText("alpha");
    await expect(app.locator(".topbar")).toContainText("opencode · e2e/fake-model");
    await app.getByRole("button", { name: "Chat" }).click();
    await expect(app.getByText(/Antwort auf: Fasse die README zusammen · Session ses_e2e_/)).toBeVisible();
    await expect(app.getByText("Ich lese zuerst die README.")).toBeVisible();

    const [record] = await hub.sessions();
    expect(record?.id).toBe(id);
    expect(record?.adapter).toBe("opencode");
  });

  test("Startprompt und eigene Antworten stehen im Chat, in Reihenfolge @desktop", async ({ app, hub }) => {
    await app.getByRole("button", { name: "Neue Session" }).click();
    await app.getByLabel("Adapter").selectOption("opencode");
    await app.getByPlaceholder("Refactore den Auth-Flow…").fill("Mein Startprompt");
    await app.getByRole("button", { name: "Starten" }).click();
    await app.getByRole("button", { name: "Chat" }).click();
    await expect(app.getByText(/Antwort auf: Mein Startprompt/)).toBeVisible();
    const id = decodeURIComponent(app.url().split("#/sessions/")[1]!);
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "idle");
    await app.getByPlaceholder("Antworten…").fill("Meine Rückfrage");
    await app.getByRole("button", { name: "Senden" }).click();
    await expect(app.getByText(/Antwort auf: Meine Rückfrage/)).toBeVisible();
    const chat = await app.locator(".event.user, .event.assistant").allTextContents();
    const order = chat.map((t) => (t.includes("Antwort auf") ? "llm" : t.includes("Mein Startprompt") ? "start" : t.includes("Meine Rückfrage") ? "reply" : "?"));
    expect(order).toEqual(["start", "llm", "reply", "llm"]);
    await expect(app.locator(".event.user").first()).toContainText("Du");
  });

  test("die Übersicht gruppiert nach Projekt und öffnet eine Session", async ({ app, hub }) => {
    await hub.createSession({ adapter: "dummy" });
    await hub.createSession({ adapter: "dummy", project: hub.beta });
    await expect(app.locator(".project-tile-header")).toHaveText(["beta", "alpha"]);
    await app.locator(".project-tile").filter({ hasText: "alpha" }).locator(".session-open").click();
    await expect(app.locator(".topbar")).toContainText("alpha");
    await expect(app.locator(".topbar")).toContainText("dummy");
  });

  test("Verlauf filtert große Tool-Ergebnisse und merkt sich den Filter", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Lies alles GROSS" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant"), "assistant reply");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByRole("button", { name: "Verlauf" }).click();
    await expect(app.locator(".event.tool_use")).toHaveCount(1);
    await expect(app.locator(".event.tool_result")).toHaveCount(0);
    await app.getByRole("button", { name: "Debuggen" }).click();
    await expect(app.locator(".event.tool_result")).toHaveCount(1);
    // The filter is stored by an effect after render — wait for it, as a
    // user's reload never lands inside the same frame.
    await expect.poll(() => app.evaluate(() => localStorage.getItem("uacc.filter"))).toBe("debuggen");
    await app.reload();
    await app.getByRole("button", { name: "Verlauf" }).click();
    await expect(app.getByRole("button", { name: "Debuggen" })).toHaveClass(/active/);
    await expect(app.locator(".event.tool_result")).toHaveCount(1);
  });

  test.describe("lange Session", () => {
    test.use({ hubOptions: { dummyAutoStop: 160 } });

    test("beim Öffnen steht das Ende da, nicht nur die ersten 100 Events (BUG-0026) @desktop", async ({ app, hub }) => {
      const id = await hub.createSession({ adapter: "dummy" });
      await hub.until(async () => (await hub.events(id)).some((e) => e.summary === "dummy: auto-stop reached"), "dummy done", 20_000);
      await app.goto(`${hub.origin}/#/sessions/${id}`);
      await app.getByRole("button", { name: "Verlauf" }).click();
      await app.getByRole("button", { name: "Debuggen" }).click();
      await expect(app.getByText("dummy: auto-stop reached")).toBeVisible();
      const last = (await hub.events(id)).at(-1)!.seq;
      await expect(app.locator(`.event[data-seq="${last}"]`)).toHaveCount(1);
    });
  });

  test("jedes Event erscheint genau einmal, auch beim Öffnen mitten im Lauf (BUG-0023)", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByRole("button", { name: "Verlauf" }).click();
    await app.getByRole("button", { name: "Debuggen" }).click();
    await hub.until(async () => (await hub.events(id)).some((e) => e.summary === "dummy: auto-stop reached"), "dummy done");
    const api = (await hub.events(id)).map((e) => e.seq);
    await expect.poll(() => app.locator(".event[data-seq]").evaluateAll((els) => els.map((el) => Number(el.getAttribute("data-seq"))))).toEqual(api);
  });

  test("ein Link auf eine andere Session zeigt nur deren Verlauf (BUG-0024)", async ({ app, hub }) => {
    const first = await hub.createSession({ adapter: "opencode", prompt: "Erste Session" });
    const second = await hub.createSession({ adapter: "opencode", prompt: "Zweite Session" });
    await app.goto(`${hub.origin}/#/sessions/${first}`);
    await app.getByRole("button", { name: "Chat" }).click();
    await expect(app.getByText(/Antwort auf: Erste Session/)).toBeVisible();
    await app.evaluate((id) => ((globalThis as unknown as { location: { hash: string } }).location.hash = `#/sessions/${id}`), second);
    await expect(app.getByText(/Antwort auf: Zweite Session/)).toBeVisible();
    await expect(app.getByText(/Antwort auf: Erste Session/)).toHaveCount(0);
  });

  test("eine Karte klappt beim Antippen auf und zeigt Details", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Kurz" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant"), "assistant reply");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByRole("button", { name: "Verlauf" }).click();
    const card = app.locator(".event.tool_use").first();
    await card.click();
    await expect(card).toHaveClass(/expanded/);
    await expect(card.locator(".event-detail")).toContainText("README.md");
  });

  test("ein Denkschritt am Längenlimit erscheint im Chat (T5.9)", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Denk nur LIMIT" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByRole("button", { name: "Chat" }).click();
    await expect(app.getByText(/am Längenlimit aufgehört\. 3900 Tokens gingen ins Denken/)).toBeVisible();
  });

  test("der Bericht zeigt Kosten, Tokens und geänderte Dateien", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Lege eine DATEI an" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant"), "assistant reply");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByRole("button", { name: "Bericht" }).click();
    const row = (label: string) => app.locator(".kv-row").filter({ hasText: label }).locator(".v");
    await expect(row("Kosten")).toContainText("$0.0012");
    await expect(row("Tokens")).toContainText("321");
    await expect(row("Dateien geändert")).toContainText("1");
  });

  test("der Diff zeigt die geänderte Datei der Session", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Lege eine DATEI an" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant"), "assistant reply");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByRole("button", { name: "Diff" }).click();
    const file = app.locator(".diff-file-row").filter({ hasText: "e2e-change.txt" });
    await expect(file).toBeVisible();
    await expect(file.locator(".diff-add-count")).toHaveText("+1");
  });

  test("die Suche findet Text in der Projekt-Doku und öffnet die Datei", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByRole("button", { name: "Suche" }).click();
    await app.getByPlaceholder("Doku durchsuchen (Markdown)…").fill("Handbuch");
    await app.getByRole("button", { name: "Suchen" }).click();
    const hit = app.locator(".search-result-card").filter({ hasText: "README.md" });
    await expect(hit).toBeVisible({ timeout: 20_000 });
    await hit.click();
    await expect(app.getByText("Das Handbuch beschreibt den Handoff zwischen PC und Handy.")).toBeVisible();
  });

  test("ein Provider-Absturz bleibt im Verlauf sichtbar", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Bitte FEHLER" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByRole("button", { name: "Verlauf" }).click();
    await expect(app.getByText("opencode: process exited with code 3")).toBeVisible();
    await expect(statusPill(app)).not.toHaveText("stopped");
  });
});
