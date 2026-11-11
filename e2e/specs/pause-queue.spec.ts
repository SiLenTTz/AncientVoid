import type { Page } from "@playwright/test";
import { test, expect } from "../support/fixtures.ts";

/**
 * EPIC-P15 T15.3: Nachrichten vormerken und eine laufende Session pausieren.
 * Die Attrappe der Claude-CLI hält den Zug mit LANGSAM offen, mit ZUEGIG 3 s.
 */
test.describe("Pause und Warteschlange", () => {
  const sessionPrompts = async (hub: { events: (id: string) => Promise<{ type: string; summary: string; payload: Record<string, unknown> }[]> }, id: string) =>
    (await hub.events(id)).filter((e) => (e.payload as { kind?: string }).kind === "session.prompt" || e.type === "user").map((e) => e.summary);

  async function open(app: Page, origin: string, id: string) {
    await app.goto(`${origin}/#/sessions/${id}`);
    await expect(app.getByPlaceholder("Antworten…")).toBeVisible();
  }

  test("Vormerken: die Nachricht wartet, steht in der Liste und geht am Zugende raus (AC-P15-4)", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "claude", prompt: "ZUEGIG erste Frage" });
    await open(app, hub.origin, id);
    await app.getByPlaceholder("Antworten…").fill("zweite Frage danach");
    // Während des Zugs ersetzt Vormerken den Senden-Knopf — es gibt keinen zweiten daneben.
    await expect(app.getByRole("button", { name: "Senden" })).toHaveCount(0);
    await expect(app.getByRole("button", { name: "Vormerken" })).toHaveCount(1);
    await app.getByRole("button", { name: "Vormerken" }).click();
    await expect(app.locator(".queue-list")).toContainText("zweite Frage danach");
    // ... und sie geht nach dem Zugende genau einmal raus:
    await expect(app.locator(".queue-list")).toHaveCount(0, { timeout: 20_000 });
    await hub.until(async () => (await sessionPrompts(hub, id)).filter((t) => t.includes("zweite Frage danach")).length >= 1, "vorgemerkter Prompt gesendet", 20_000);
    expect((await sessionPrompts(hub, id)).filter((t) => t.includes("zweite Frage danach"))).toHaveLength(1);
  });

  test("eine vorgemerkte Nachricht lässt sich streichen — sie geht nie raus", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "claude", prompt: "LANGSAM erste Frage" });
    await open(app, hub.origin, id);
    await app.getByPlaceholder("Antworten…").fill("doch nicht");
    await app.getByRole("button", { name: "Vormerken" }).click();
    await expect(app.locator(".queue-list")).toContainText("doch nicht");
    await app.getByRole("button", { name: /Vorgemerkte Nachricht 1 streichen/ }).click();
    await expect(app.locator(".queue-list")).toHaveCount(0);
    expect(await sessionPrompts(hub, id)).not.toContain("doch nicht");
  });

  test("BUG-0114: eine vorgemerkte Nachricht lässt sich sofort in den laufenden Zug senden", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "claude", prompt: "LANGSAM erste Frage" });
    await open(app, hub.origin, id);
    await app.getByPlaceholder("Antworten…").fill("kurze Zwischenfrage");
    await app.getByRole("button", { name: "Vormerken" }).click();
    await expect(app.locator(".queue-list")).toContainText("kurze Zwischenfrage");

    await app.getByRole("button", { name: /Vorgemerkte Nachricht 1 jetzt senden/ }).click();
    await expect(app.locator(".queue-list")).toHaveCount(0);

    // Der Prompt ist sofort angekommen — während der LANGSAM-Zug (60 s) noch läuft.
    await hub.until(async () => (await sessionPrompts(hub, id)).some((t) => t.includes("kurze Zwischenfrage")), "vorgemerkter Prompt sofort gesendet", 20_000);
    expect((await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status).toBe("working");
    expect((await sessionPrompts(hub, id)).filter((t) => t.includes("kurze Zwischenfrage"))).toHaveLength(1);
  });

  test("Pause hält den Zug an, die Session steht auf pausiert und läuft mit „Weiter“ wieder (AC-P15-4)", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "claude", prompt: "LANGSAM erste Frage" });
    await open(app, hub.origin, id);
    await app.getByRole("button", { name: "Pause" }).click();
    await expect(app.locator(".session-top-meta .pill")).toHaveText("pausiert");
    await expect(app.getByRole("button", { name: "Pause" })).toHaveCount(0);
    await app.getByPlaceholder("Antworten…").fill("mach bitte weiter");
    await app.getByRole("button", { name: "Weiter" }).click();
    await expect(app.locator(".session-top-meta .pill")).not.toHaveText("pausiert");
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant" && e.summary.length > 0), "Antwort nach der Pause", 20_000);
  });

  test("Adapter ohne Anhalten zeigen keinen Pause-Knopf", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "claude-clip" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.locator(".dock-stack")).toBeVisible();
    await expect(app.getByRole("button", { name: "Pause" })).toHaveCount(0);
  });
});

test.describe("Steer-Timeout (AC-P17-3)", () => {
  // T17.4: der Hub wartet hart begrenzt auf die Annahme eines Prompts. Ein
  // Timeout beweist nichts — derselbe inputId wird nie zweimal gesendet.
  test.use({ hubOptions: { steerWaitMs: 3_000 } });

  test("eine hängende Antwort endet mit Timeout-Event und wird nie doppelt gesendet", async ({ hub }) => {
    test.setTimeout(90_000);
    const id = await hub.createSession({ adapter: "codex", prompt: "erste Frage SPAETES_ENDE" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant"), "erste Antwort", 30_000);
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "erster Zug abgeschlossen", 30_000);

    const body = { kind: "prompt", text: "STUMM zweite Frage", inputId: "stumm-1" };
    const first = await hub.api<{ ok: boolean; detail?: string }>(`/api/sessions/${id}/steer`, { method: "POST", body });
    expect(first.status).toBe(422);
    expect(first.body.detail).toMatch(/steer timeout/);

    // Fail loud: der Timeout steht als eigenes Event im Verlauf …
    const events = await hub.events(id);
    expect(events.filter((e) => (e.payload as { kind?: string }).kind === "session.steer_timeout")).toHaveLength(1);

    // … und der Retry mit derselben inputId ist keine zweite Submission.
    const retry = await hub.api<{ ok: boolean; detail?: string }>(`/api/sessions/${id}/steer`, { method: "POST", body });
    expect(retry.status).toBe(422);
    expect(retry.body.detail).toMatch(/in flight/);
    const asked = (await hub.events(id)).filter(
      (e) => e.type === "user" && String((e.payload as { text?: string }).text).includes("STUMM"),
    );
    expect(asked).toHaveLength(1);
  });
});
