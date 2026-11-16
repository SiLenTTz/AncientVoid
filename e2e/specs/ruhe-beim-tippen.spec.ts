import { test, expect } from "../support/fixtures.ts";

/**
 * BUG-0049: beim Tippen klappt die Zeile „Entwurf gespeichert …“ bei jeder Pause
 * auf und zu (Status saving → saved) und schiebt das Dock mit.
 */
test.describe("Ruhe beim Tippen", () => {
  // Browser-Code als String: das e2e-tsconfig hat keine DOM-Typen.
  const watchDraft = `
    (() => {
      const w = window;
      w.__draft = { seen: false, vanished: 0, texts: [] };
      let present = false;
      const update = () => {
        const el = document.querySelector(".draft-state");
        const text = el ? (el.textContent || "").trim() : "";
        const now = text.length > 0;
        if (now && !w.__draft.seen) w.__draft.seen = true;
        if (!now && present) w.__draft.vanished += 1;
        if (now && !w.__draft.texts.includes(text)) w.__draft.texts.push(text);
        present = now;
      };
      new MutationObserver(update).observe(document.body, { childList: true, subtree: true, characterData: true });
      update();
    })()
  `;

  test("BUG-0049: die Entwurf-Zeile bleibt stehen, während man tippt, und wechselt ihren Text nicht", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "claude", prompt: "Hallo" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant"), "erste Antwort", 20_000);
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    const field = app.getByPlaceholder("Antworten…");
    await expect(field).toBeVisible();
    await app.evaluate(watchDraft);

    // Mit Pausen tippen: jede Pause stößt das Speichern an (saving → saved).
    for (let i = 0; i < 6; i++) {
      await field.pressSequentially("wort ", { delay: 40 });
      await app.waitForTimeout(700);
    }
    await expect(app.locator(".draft-state")).toContainText("Entwurf");
    const seen = (await app.evaluate(`window.__draft`)) as { seen: boolean; vanished: number; texts: string[] };
    expect(seen.seen).toBe(true);
    expect(seen.vanished).toBe(0); // nie weg und wieder da
    expect(seen.texts).toHaveLength(1); // und nie ein anderer Wortlaut
  });
});
