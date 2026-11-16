import { test, expect } from "../support/fixtures.ts";

/** Globaler Nyx-FAB: Speech-to-Text in das fokussierte Feld (+ Zwischenablage). */

test.describe("Nyx-FAB (Speech-to-Text)", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      class FakeRecognition {
        lang = "";
        interimResults = false;
        continuous = false;
        maxAlternatives = 1;
        onstart: (() => void) | null = null;
        onresult: ((e: unknown) => void) | null = null;
        onerror: ((e: unknown) => void) | null = null;
        onend: (() => void) | null = null;
        start() {
          const text = (globalThis as unknown as { __speech?: string }).__speech ?? "hallo welt";
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

  test("FAB ist sichtbar; Composer hat keinen Voice-Button mehr", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.locator('[data-testid="nyx-fab"]')).toBeVisible();
    await expect(app.locator(".composer-actions").getByRole("button", { name: "Voice" })).toHaveCount(0);
  });

  test("Klick diktiert in das fokussierte Antwortfeld", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    const field = app.getByPlaceholder("Antworten…");
    await field.click();
    await app.evaluate(() => ((globalThis as unknown as { __speech: string }).__speech = "bitte weitermachen"));
    await app.locator('[data-testid="nyx-fab"]').click();
    await expect(field).toHaveValue("bitte weitermachen");
  });

  test("Position bleibt nach Drag je Breakpoint erhalten", async ({ app, hub }) => {
    await app.setViewportSize({ width: 390, height: 800 });
    const id = await hub.createSession({ adapter: "dummy" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    const fab = app.locator('[data-testid="nyx-fab"]');
    await expect(fab).toHaveAttribute("data-bp", "phone");
    const box = await fab.boundingBox();
    expect(box).toBeTruthy();
    await fab.dispatchEvent("pointerdown", { clientX: box!.x + 10, clientY: box!.y + 10, pointerId: 1, buttons: 1 });
    await fab.dispatchEvent("pointermove", { clientX: box!.x + 10, clientY: box!.y - 100, pointerId: 1, buttons: 1 });
    await fab.dispatchEvent("pointerup", { clientX: box!.x + 10, clientY: box!.y - 100, pointerId: 1, buttons: 0 });
    const after = await fab.boundingBox();
    expect(after!.y).toBeLessThan(box!.y - 40);
    await app.reload();
    await expect(app.locator('[data-testid="nyx-fab"]')).toBeVisible();
    const again = await app.locator('[data-testid="nyx-fab"]').boundingBox();
    expect(Math.abs((again?.y ?? 0) - (after?.y ?? 0))).toBeLessThan(8);
  });

  test("BUG-0138: in der Standardposition liegt der FAB über dem Dock, nie auf dessen Tasten", async ({ app, hub }) => {
    await app.setViewportSize({ width: 390, height: 800 });
    const id = await hub.createSession({ adapter: "claude", prompt: "LANGSAM erste Frage" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.getByRole("button", { name: "Pause" })).toBeVisible();
    await expect
      .poll(async () => {
        const [fab, dock] = await Promise.all([app.locator('[data-testid="nyx-fab"]').boundingBox(), app.locator(".dock-stack").boundingBox()]);
        return fab!.y + fab!.height <= dock!.y;
      })
      .toBe(true);
  });

  test("BUG-0145: das Ende des Verlaufs lässt sich über den FAB scrollen", async ({ app, hub }) => {
    await app.setViewportSize({ width: 390, height: 800 });
    const id = await hub.createSession({ adapter: "dummy" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    const tail = app.locator(".tail-scroll");
    await expect.poll(() => tail.evaluate((el) => el.scrollHeight > el.clientHeight + 200)).toBe(true);
    await expect
      .poll(async () => {
        await tail.evaluate((el) => el.scrollTo(0, el.scrollHeight));
        const fab = (await app.locator('[data-testid="nyx-fab"]').boundingBox())!;
        // Unterkante des letzten Inhalts im Scrollbereich, nicht des (gepolsterten) Containers.
        const contentBottom = await tail.evaluate((el) => Math.max(...[...el.children].map((c) => c.getBoundingClientRect().bottom)));
        return contentBottom <= fab.y;
      })
      .toBe(true);
  });

  test("lässt sich mit echter Maus ziehen (kein nativer Bild-Drag) und ist ≥ 64 px groß", async ({ app, hub }) => {
    await app.setViewportSize({ width: 1400, height: 900 });
    const id = await hub.createSession({ adapter: "dummy" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    const fab = app.locator('[data-testid="nyx-fab"]');
    const box = (await fab.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(64);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await app.mouse.move(cx, cy);
    await app.mouse.down();
    await app.mouse.move(cx - 200, cy + 120, { steps: 12 });
    await app.mouse.up();
    const after = (await fab.boundingBox())!;
    expect(after.x).toBeLessThan(box.x - 150);
    expect(after.y).toBeGreaterThan(box.y + 80);
    // Ziehen ist kein Klick: es startet keine Aufnahme.
    await expect(app.locator('[data-testid="nyx-fab-toast"]')).toHaveCount(0);
  });
});
