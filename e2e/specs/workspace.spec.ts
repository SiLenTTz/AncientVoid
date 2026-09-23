import { test, expect, statusPill } from "../support/fixtures.ts";

test.describe("Archiv (P5 §9)", () => {
  test("Archivieren nimmt die Session aus der Übersicht, der Archiv-Chip holt sie zurück @desktop", async ({ app, hub }) => {
    await hub.createSession({ adapter: "dummy" });
    const card = app.locator(".session-card");
    await expect(card).toHaveCount(1);
    await card.getByRole("button", { name: "Archivieren" }).click();
    await expect(card).toHaveCount(0);
    await app.getByRole("button", { name: "Archiv (1)" }).click();
    await expect(card).toHaveCount(1);
    await card.getByRole("button", { name: "Zurückholen" }).click();
    await app.getByRole("button", { name: "Aktive" }).click();
    await expect(card).toHaveCount(1);
  });

  test("Archivieren aus der Session heraus bleibt nach Reload", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.locator(".topbar").getByRole("button", { name: "Archivieren" }).click();
    await expect(app.locator(".topbar").getByRole("button", { name: "Zurückholen" })).toBeVisible();
    expect((await hub.api<{ archived: boolean }>(`/api/sessions/${id}`)).body.archived).toBe(true);
  });
});

test.describe("Freigaben (T2.4, T2.6)", () => {
  test.use({ hubOptions: { requireStepApprovals: true } });

  test("eine Antwort wartet auf Freigabe und kommt nach „Freigeben“ an", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Start" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant"), "first answer");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByPlaceholder("Antworten…").fill("Bitte freigeben");
    await app.getByRole("button", { name: "Senden" }).click();
    await expect(app.locator(".reply-error")).toContainText("pending approval");

    await app.getByRole("button", { name: "Übersicht" }).click();
    await app.getByRole("button", { name: /1 Freigabe wartet auf dich/ }).click();
    const approval = app.locator(".approval-card").filter({ hasText: "Bitte freigeben" });
    await expect(approval.getByText("Bestätigung")).toBeVisible();
    const reason = approval.getByPlaceholder("Begründung (Pflicht)…");
    if (await reason.count()) await reason.fill("passt");
    await approval.getByRole("button", { name: "Freigeben" }).click();
    await hub.until(
      async () => (await hub.events(id)).some((e) => e.type === "assistant" && String(e.payload.text).includes("Bitte freigeben")),
      "approved prompt answered",
    );
    await expect(app.getByText("keine offenen Freigaben")).toBeVisible();
  });

  test("„Ablehnen“ verwirft die Antwort", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Start" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant"), "first answer");
    await hub.api(`/api/sessions/${id}/steer`, { body: { kind: "prompt", text: "Bitte ablehnen" } });
    await app.reload();
    await app.getByRole("button", { name: /1 Freigabe wartet auf dich/ }).click();
    const approval = app.locator(".approval-card").filter({ hasText: "Bitte ablehnen" });
    await approval.getByRole("button", { name: "Ablehnen" }).click();
    await expect(app.getByText("keine offenen Freigaben")).toBeVisible();
    const answers = (await hub.events(id)).filter((e) => e.type === "assistant");
    expect(answers.map((e) => String(e.payload.text))).not.toContainEqual(expect.stringContaining("Bitte ablehnen"));
  });
});

test.describe("Budget (T2.7)", () => {
  test("eine Session über Budget pausiert und läuft nach Erhöhen weiter", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Teuer", budgetUsd: 0.001 });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "parked", "budget park");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(statusPill(app)).toHaveText("parked");
    await app.getByRole("button", { name: "Bericht" }).click();
    await expect(app.getByText("Session wegen Budget pausiert.")).toBeVisible();
    await app.locator('input[type="number"]').fill("1");
    await app.getByRole("button", { name: "Budget erhöhen" }).click();
    await expect(app.getByText(/Budget erhöht|pending approval|Freigabe/)).toBeVisible();
  });
});

test.describe("Composer: Verbessern, Empfehlung, Skills (T3.9, T5.7–T5.10)", () => {
  test("Verbessern zeigt Original und Vorschlag und übernimmt ihn", async ({ app }) => {
    await app.getByRole("button", { name: "Neue Session" }).click();
    await app.getByLabel("Adapter").selectOption("opencode");
    const prompt = app.getByPlaceholder("Refactore den Auth-Flow…");
    await prompt.fill("mach die login seite schneller");
    await app.getByRole("button", { name: "Verbessern" }).click();
    const preview = app.locator(".enhance-preview");
    await expect(preview).toContainText("mach die login seite schneller");
    await expect(preview).toContainText("Ziel: mach die login seite schneller");
    await expect(preview).toContainText("$0.0004");
    await app.getByRole("button", { name: "Verbessertes übernehmen" }).click();
    await expect(prompt).toHaveValue(/^Ziel: mach die login seite schneller\nScope:/);
  });

  test("„Original senden“ behält den eigenen Text", async ({ app }) => {
    await app.getByRole("button", { name: "Neue Session" }).click();
    await app.getByLabel("Adapter").selectOption("opencode");
    const prompt = app.getByPlaceholder("Refactore den Auth-Flow…");
    await prompt.fill("bleib wie du bist");
    await app.getByRole("button", { name: "Verbessern" }).click();
    await app.getByRole("button", { name: "Original senden" }).click();
    await expect(prompt).toHaveValue("bleib wie du bist");
  });

  test("nach Verbessern kommt eine Empfehlung, die man verwerfen oder nutzen kann", async ({ app }) => {
    await app.getByRole("button", { name: "Neue Session" }).click();
    await app.getByLabel("Adapter").selectOption("opencode");
    const prompt = app.getByPlaceholder("Refactore den Auth-Flow…");
    await prompt.fill("Neon-Styling für die Oberfläche");
    await app.getByRole("button", { name: "Verbessern" }).click();
    const card = app.locator(".recommend-card");
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Verwerfen" }).click();
    await expect(card).toHaveCount(0);

    await app.getByRole("button", { name: "Verbessern" }).click();
    await expect(card).toBeVisible();
    const name = (await card.locator("strong").textContent())!.trim();
    await card.getByRole("button", { name: "Nutzen" }).click();
    await expect(prompt).toHaveValue(new RegExp(`^/${name}\\n\\n`));
  });

  test("Skills gibt es nur für Adapter mit Skill-Aufruf", async ({ app }) => {
    await app.getByRole("button", { name: "Neue Session" }).click();
    await app.getByLabel("Adapter").selectOption("opencode");
    await expect(app.getByText("Skills/Agents: für diesen Adapter nicht verfügbar")).toBeVisible();
  });

  test("ein Projekt-Skill lädt seine extends-Kette und zeigt sie im Chat (T5.10)", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Mach es bunt", args: { skill: "neon" } });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByRole("button", { name: "Chat" }).click();
    await expect(app.getByText("Skills task → neon")).toBeVisible();
    await expect(app.getByText(/Antwort auf: Mach es bunt/)).toBeVisible();
  });

  test.fixme("Skill-Picker-Overlay für Claude (braucht einen nachgebauten claude-CLI im E2E-PATH)", async () => {});
});

test.describe("Sprache (T1.5, T3.10)", () => {
  test.beforeEach(async ({ page }) => {
    // Chromium headless has no speech service; this stands in for the
    // browser's recognizer with the same event shape.
    await page.addInitScript(() => {
      class FakeRecognition {
        lang = "";
        interimResults = false;
        continuous = false;
        onstart: (() => void) | null = null;
        onresult: ((e: unknown) => void) | null = null;
        onerror: ((e: unknown) => void) | null = null;
        onend: (() => void) | null = null;
        start() {
          const text = (globalThis as unknown as { __speech?: string }).__speech ?? "stopp";
          setTimeout(() => {
            this.onstart?.();
            this.onresult?.({ results: [[{ transcript: text }]] });
            this.onend?.();
          }, 30);
        }
        abort() {}
      }
      (globalThis as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;
    });
  });

  test("Diktat füllt das Antwortfeld", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.evaluate(() => ((globalThis as unknown as { __speech: string }).__speech = "bitte weitermachen"));
    await app.locator(".composer-actions").getByRole("button", { name: "Voice" }).click();
    await expect(app.getByPlaceholder("Antworten…")).toHaveValue("bitte weitermachen");
  });

  test("„stopp“ im Voice-Sheet stoppt nach Bestätigung die Session", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Arbeite LANGSAM" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.locator(".dock").getByRole("button", { name: "Voice" }).click();
    await app.getByTitle("Tippen zum Sprechen").click();
    await expect(app.getByText("„stopp\"")).toBeVisible();
    await app.getByRole("button", { name: "Bestätigen" }).click();
    await app.getByRole("button", { name: "✕" }).click();
    await expect(statusPill(app)).toHaveText("stopped");
  });
});

test.describe("Offline (K10)", () => {
  test.fixme("BUG-0015: Neuladen ohne Netz zeigt gecachte Sessions statt der Token-Eingabe", async () => {});
});
