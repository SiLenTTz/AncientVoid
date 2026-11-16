import { test, expect, sessionTab } from "../support/fixtures.ts";

/**
 * BUG-0178 / ADR-0083: der Beweis, dass hier **echt** gestreamt wird und nicht
 * nachträglich getippt. Der Dummy sendet Live-Frames und lässt das dauerhafte
 * Block-Ereignis um `blockLeadMs` später kommen — in diesem Fenster steht Text im
 * Chat, den es im Event-Store noch gar nicht gibt. Genau das war vorher unmöglich.
 */
test.describe("Echtes Streaming (BUG-0178, ADR-0083)", () => {
  test.use({ hubOptions: { dummyLiveFrames: true, dummyBlockLeadMs: 1500, dummyEventsPerSecond: 3, dummyAutoStop: 12 } });

  test("Teiltext steht im Chat, bevor das Ereignis existiert — und rückt beim Block ein", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await sessionTab(app, "Chat");

    const live = app.getByTestId("chat-live-assistant");
    await expect(live).toBeVisible({ timeout: 15_000 });
    const partial = ((await live.textContent()) ?? "").trim();
    expect(partial).toMatch(/^dummy assistant #\d+ live$/);
    if (process.env.LIVE_SHOT) await app.screenshot({ path: "test-results/live-bubble.png" }); // Sichtpruefung; laeuft in CI nicht

    const n = /#(\d+)/.exec(partial)?.[1];
    expect(n).toBeTruthy();

    // Der entscheidende Punkt: zu diesem Zeitpunkt gibt es das zugehörige Ereignis noch nicht.
    const persisted = await hub.api<{ type: string; summary: string }[]>(`/api/sessions/${id}/events?afterSeq=0&limit=300`);
    expect((persisted.body ?? []).some((e) => e.summary === `dummy assistant #${n}`)).toBe(false);
    await expect(app.locator(`.event >> text=dummy assistant #${n}`)).toHaveCount(0);

    // Danach kommt der Block: die Blase verschwindet, der Text bleibt als Ereignis stehen.
    await expect(live).toBeHidden({ timeout: 15_000 });
    await expect(app.locator(`.event >> text=dummy assistant #${n}`)).toBeVisible({ timeout: 15_000 });
    const after = await hub.api<{ type: string; summary: string }[]>(`/api/sessions/${id}/events?afterSeq=0&limit=300`);
    expect((after.body ?? []).some((e) => e.type === "assistant" && e.summary === `dummy assistant #${n}`)).toBe(true);
    // Frames sind nie persistiert: kein Ereignis trägt nur einen Frame-Teil.
    expect((after.body ?? []).some((e) => e.summary === "dummy assistant #live" || e.summary === "live")).toBe(false);
  });

});

test.describe("Ohne Frames keine Live-Blase (BUG-0178)", () => {
  test.use({ hubOptions: { dummyEventsPerSecond: 6, dummyAutoStop: 12 } });

  test("der Dummy ohne liveFrames sendet keine Frames und die Blase bleibt weg", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await sessionTab(app, "Chat");
    await expect(app.locator(".event").first()).toBeVisible({ timeout: 15_000 });
    await expect(app.getByTestId("chat-live")).toHaveCount(0);
  });
});

test.describe("Echtes Streaming durch den echten claude-Adapter (BUG-0178)", () => {
  // BUG-0179: Windows kann die extensionslosen Stand-in-CLIs nicht spawnen. Auf
  // diesem Rechner ist der Weg nicht pruefbar; der Adapter-Pfad selbst ist durch
  // packages/adapters/claude/test/adapter.test.ts abgedeckt. Kein Bestehen, ein Skip.
  test.skip(process.platform === "win32", "BUG-0179: Stand-in-CLI laeuft auf Windows nicht");
  test("claude-Deltas kommen als Frames an, bevor sein Block existiert", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "claude" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await sessionTab(app, "Chat");
    // The initial empty turn may already have an assistant block. Only the
    // prompted turn belongs to this measurement.
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "initial turn idle");
    const baseline = Math.max(0, ...(await hub.events(id)).map((event) => event.seq));
    await app.getByPlaceholder("Antworten…").fill("Bitte STREAM");
    await app.getByRole("button", { name: "Senden" }).click();

    const live = app.getByTestId("chat-live-assistant");
    await expect(live).toBeVisible({ timeout: 25_000 });
    const partial = ((await live.textContent()) ?? "").trim();
    expect(partial.length).toBeGreaterThan(0);

    // Der Stand-in antwortet exakt mit den getreamten Teilen — es gibt aber noch
    // kein assistant-Ereignis, solange nur Frames gelaufen sind.
    const during = await hub.api<{ type: string }[]>(`/api/sessions/${id}/events?afterSeq=${baseline}&limit=300`);
    expect(during.body.some((e) => e.type === "assistant")).toBe(false);

    await expect(live).toBeHidden({ timeout: 25_000 });
    const after = await hub.api<{ type: string; payload?: { text?: string } }[]>(`/api/sessions/${id}/events?afterSeq=${baseline}&limit=300`);
    const blocks = after.body.filter((e) => e.type === "assistant");
    expect(blocks.length).toBe(1);
    expect(JSON.stringify(blocks[0]!.payload)).toContain("Live streamt Wort für Wort.");
  });
});
