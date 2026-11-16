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
