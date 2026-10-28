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
    await expect(app.locator(".session-topbar")).toContainText("alpha");
    await expect(app.locator(".session-topbar")).toContainText("opencode · e2e/fake-model");
    // 2026-10-26: host and model are always visible — the model from the
    // registration's default (hub.ts configures model for the e2e opencode),
    // the host from the fleet's own label (this machine's real hostname).
    const fleet = await hub.api<{ hosts: { hostId: string; self: boolean; label?: string }[] }>("/api/fleet");
    const selfLabel = fleet.body.hosts.find((h) => h.self)?.label;
    await expect(app.locator(".session-topbar")).toContainText(selfLabel ?? "dieser Rechner");
    await app.getByRole("button", { name: "Chat" }).click();
    await expect(app.locator(".tail-scroll").getByText(/Antwort auf: Fasse die README zusammen · Session ses_e2e_/)).toBeVisible();
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
    await expect(app.locator(".tail-scroll").getByText(/Antwort auf: Mein Startprompt/)).toBeVisible();
    const id = decodeURIComponent(app.url().split("#/sessions/")[1]!);
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "idle");
    await app.getByPlaceholder("Antworten…").fill("Meine Rückfrage");
    await app.getByRole("button", { name: "Senden" }).click();
    await expect(app.locator(".tail-scroll").getByText(/Antwort auf: Meine Rückfrage/)).toBeVisible();
    const chat = await app.locator(".event.user, .event.assistant").allTextContents();
    const order = chat.map((t) => (t.includes("Antwort auf") ? "llm" : t.includes("Mein Startprompt") ? "start" : t.includes("Meine Rückfrage") ? "reply" : "?"));
    expect(order).toEqual(["start", "llm", "reply", "llm"]);
    await expect(app.locator(".event.user").first()).toContainText("Du");
  });

  test("⌘/Ctrl+Enter sendet die Antwort aus dem Eingabefeld (Tablet mit Tastatur) @desktop", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Tastatur Start" });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "idle");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    const box = app.getByPlaceholder("Antworten…");
    await box.fill("Gesendet per Tastatur");
    // Plain Enter must stay a newline (one-handed phone use): the value
    // grows, nothing is sent.
    await box.press("Enter");
    await expect(box).toHaveValue("Gesendet per Tastatur\n");
    await box.press("Control+Enter");
    await expect(app.locator(".event.user").last()).toContainText("Gesendet per Tastatur");
    await expect(box).toHaveValue("");
  });

  test("jede Karte in der Übersicht nennt Projekt und Auftrag @desktop", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Workflow: release\n\nBaue die Punkteanzeige" });
    await hub.createSession({ adapter: "opencode", project: hub.beta, prompt: "Ziel: Menü aufräumen\nScope: nur beta" });
    const alpha = app.locator(".session-card").filter({ hasText: "Baue die Punkteanzeige" });
    await expect(alpha.locator(".session-project")).toHaveText("alpha");
    const beta = app.locator(".session-card").filter({ hasText: "Menü aufräumen" });
    await expect(beta.locator(".session-project")).toHaveText("beta");
    await expect(beta).toContainText("opencode");
    // card shows the model (registration default) and the readable host too
    await expect(beta).toContainText("e2e/fake-model");
  });

  test("T8.1: die Übersicht ordnet nach „Braucht dich“, „Aktiv“, „Zuletzt“ und öffnet eine Session", async ({ app, hub }) => {
    await hub.createSession({ adapter: "dummy" });
    const stopped = await hub.createSession({ adapter: "dummy", project: hub.beta });
    await hub.api(`/api/sessions/${stopped}/stop`, { body: {} });
    const waiting = await hub.createSession({ adapter: "claude", prompt: "Bitte WERKZEUG" });
    await expect(app.locator(".section-title")).toHaveText([/Braucht dich/, /Aktiv/, /Zuletzt/]);
    const need = app.locator(".section-braucht .session-card");
    await expect(need).toHaveCount(1);
    await expect(need.locator(".pill")).toHaveText("Freigabe nötig");
    await expect(need.locator(".session-activity")).toContainText("Wartet auf Freigabe: Bash");
    // One tap from the overview to the waiting request (AC-P8-1).
    await need.locator(".session-open").click();
    await expect(app).toHaveURL(new RegExp(`#/sessions/${waiting}`));
    await expect(app.locator(".session-approvals .approval-card")).toBeVisible();
    await app.goBack();
    await expect(app.locator(".section-zuletzt .session-card .session-project")).toHaveText("beta");
    await app.locator(".section-aktiv .session-card").filter({ hasText: "alpha" }).locator(".session-open").click();
    await expect(app.locator(".session-topbar")).toContainText("alpha");
    await expect(app.locator(".session-topbar")).toContainText("dummy");
  });

  test("T8.1: jede Seite hat eine Adresse — Zurück im Browser geht zurück", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy" });
    await app.getByRole("button", { name: "Neue Session" }).click();
    await expect(app).toHaveURL(/#\/neu$/);
    await app.locator(".dock").getByRole("button", { name: "Einstellungen" }).click();
    await expect(app).toHaveURL(/#\/einstellungen$/);
    await app.goBack();
    await expect(app).toHaveURL(/#\/neu$/);
    await expect(app.getByRole("button", { name: "Starten" })).toBeVisible();
    await app.goBack();
    await expect(app.locator(".session-card")).toHaveCount(1);
    await app.locator(".session-open").click();
    await expect(app).toHaveURL(new RegExp(`#/sessions/${id}$`));
    await app.reload();
    await expect(app.locator(".session-topbar")).toContainText("dummy");
    await app.goBack();
    await expect(app.locator(".dashboard")).toBeVisible();
  });

  test("T8.6: anheften und umbenennen gilt auf allen Geräten", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy", prompt: "Erster Auftrag" });
    await hub.api(`/api/sessions/${id}/stop`, { body: {} });
    const card = app.locator(".session-card").filter({ hasText: "Erster Auftrag" });
    await card.getByRole("button", { name: "Anheften" }).click();
    await expect(app.locator(".section-pins .session-card")).toHaveCount(1);
    expect((await hub.api<{ pinned: boolean }>(`/api/sessions/${id}`)).body.pinned).toBe(true);
    await hub.api(`/api/sessions/${id}/meta`, { body: { title: "Umbenannt" } });
    await expect(app.locator(".section-pins .session-title")).toHaveText("Umbenannt");
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
    await expect(app.locator(".tail-scroll").getByText(/Antwort auf: Erste Session/)).toBeVisible();
    await app.evaluate((id) => ((globalThis as unknown as { location: { hash: string } }).location.hash = `#/sessions/${id}`), second);
    await expect(app.locator(".tail-scroll").getByText(/Antwort auf: Zweite Session/)).toBeVisible();
    await expect(app.locator(".tail-scroll").getByText(/Antwort auf: Erste Session/)).toHaveCount(0);
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

  test("T7.7: nicht gemeldete Kosten sind keine $0, geschätzte Tokens tragen ≈", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy" });
    await hub.until(async () => (await hub.events(id)).some((e) => typeof (e as { tokensEst?: number }).tokensEst === "number"), "dummy tokens");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByRole("button", { name: "Bericht" }).click();
    const row = (label: string) => app.locator(".kv-row").filter({ hasText: label }).locator(".v");
    await expect(row("Kosten")).toHaveText("nicht gemeldet");
    await expect(row("Kosten")).toHaveAttribute("title", /keine 0/);
    await expect(row("Tokens")).toContainText("≈ ");
    const record = (await hub.api<{ metrics: { cost: string; tokens: string } }>(`/api/sessions/${id}`)).body;
    expect(record.metrics).toMatchObject({ cost: "unknown", tokens: "estimated" });
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
    // Der Satz steht auch im Suchtreffer: auf breiten Fenstern bleibt die Trefferliste neben der Datei sichtbar.
    // Die Datei öffnet gerendert als Markdown (Dokumentansicht, kein Code-Viewer) — der
    // Trefferabschnitt ist markiert und angesteuert.
    await expect(app.locator(".file-viewer .markdown").getByText("Das Handbuch beschreibt den Handoff zwischen PC und Handy.")).toBeVisible();
    await expect(app.locator(".doc-hit")).toBeVisible();
    await expect(app.locator(".file-gutter, .file-code")).toHaveCount(0);
  });

  test("ein Provider-Absturz bleibt im Verlauf sichtbar", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Bitte FEHLER" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByRole("button", { name: "Verlauf" }).click();
    await expect(app.getByText("opencode: process exited with code 3")).toBeVisible();
    await expect(statusPill(app)).not.toHaveText("stopped");
  });
});
