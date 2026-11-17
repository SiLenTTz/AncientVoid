import { expect, test } from "../support/fixtures.ts";
import type { Page } from "@playwright/test";

/**
 * EPIC-P65: Status-Sounds ohne Assets. Die WebAudio-Aufrufe werden per
 * addInitScript abgefangen (Erzeugung von Context, Oszillatoren, resume) —
 * der Beweis lautet immer: wurde ein Ton konstruiert oder nicht. Echter
 * Ton auf echten Geräten bleibt Nutzerabnahme (T65.6); die Vibration ist
 * ebenfalls nur am echten Gerät prüfbar (Best effort, Unit deckt den Ausfallpfad).
 */
interface AudioSpy {
  ctxs: number;
  oscs: number;
  resumes: number;
}

async function installAudioSpy(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const spy = { ctxs: 0, oscs: 0, resumes: 0 };
    (window as unknown as Record<string, unknown>).__audioSpy = spy;
    const Orig = window.AudioContext;
    if (!Orig) return;
    const Wrapped = function () {
      const c = new Orig();
      spy.ctxs += 1;
      const origResume = c.resume.bind(c);
      c.resume = () => {
        spy.resumes += 1;
        return origResume();
      };
      const origOsc = c.createOscillator.bind(c);
      c.createOscillator = () => {
        spy.oscs += 1;
        return origOsc();
      };
      return c;
    };
    (window as unknown as Record<string, unknown>).AudioContext = Wrapped;
  });
  await page.reload();
}

async function spy(page: Page): Promise<AudioSpy> {
  return (await page.evaluate(() => (window as unknown as Record<string, AudioSpy | undefined>).__audioSpy))!;
}

test.describe("Status-Sounds (EPIC-P65)", () => {
  test("kein Ton vor der ersten Geste; danach spielt der Fehler-Ton — und beim Laden wird nichts nachgespielt", async ({ app, hub }) => {
    await installAudioSpy(app);
    await hub.createSession({ adapter: "opencode", prompt: "Bitte KONTINGENT" });
    // Die Fehler-Meldung kommt an (Toast), aber vor jeder Interaktion bleibt es still.
    await expect(app.locator(".toast").first()).toBeVisible({ timeout: 15_000 });
    expect((await spy(app)).oscs, "vor der ersten Geste wird nichts gespielt").toBe(0);
    // Die erste Geste entsperrt global — die nächste Fehler-Meldung spielt.
    await app.keyboard.press("Escape");
    await hub.createSession({ adapter: "opencode", prompt: "Bitte KONTINGENT" });
    await expect.poll(async () => (await spy(app)).oscs, { timeout: 20_000 }).toBeGreaterThan(0);
    // Kein Nachspielen beim Laden: was schon gezeigt wurde, kommt nicht nochmal —
    // weder als Toast noch als Ton.
    await app.reload();
    await expect(app.locator(".toast")).toHaveCount(0, { timeout: 3_000 });
    await app.waitForTimeout(5_000);
    expect((await spy(app)).oscs, "Reload spielt Vorhandenes nicht nach").toBe(0);
  });

  test("Master aus am Panel: Stille auch nach dem Fenster — und der Schalter bleibt aus (aria-pressed)", async ({ app, hub }) => {
    await installAudioSpy(app);
    await app.getByRole("button", { name: /Benachrichtigungen/ }).click();
    const toggle = app.getByRole("button", { name: "Töne stumm oder laut schalten" });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await app.reload();
    await app.getByRole("button", { name: /Benachrichtigungen/ }).click();
    await expect(app.getByRole("button", { name: "Töne stumm oder laut schalten" })).toHaveAttribute("aria-pressed", "true");
    await app.keyboard.press("Escape"); // Geste — ohne Master wäre der nächste Ton hörbar
    await hub.createSession({ adapter: "opencode", prompt: "Kurz" });
    await app.waitForTimeout(12_000);
    expect((await spy(app)).oscs, "Master aus ist stumm").toBe(0);
    const stored = await app.evaluate(() => JSON.parse(localStorage.getItem("ancientvoid.sounds") ?? "{}"));
    expect(stored.master).toBe(false);
  });

  test("Section Töne: Variante wählen, Vorschau spielt ohne Vorinteraktion, alles bleibt nach Reload", async ({ app, hub }) => {
    await installAudioSpy(app);
    await app.goto(`${hub.origin}/#/einstellungen`);
    const section = app.locator("[data-testid=settings-sounds]");
    await expect(section).toBeVisible();
    // info ist standardmäßig aus — einschalten, Variante wählen, Vorschau: die ist die Geste.
    await section.getByRole("switch", { name: "Ton Info" }).click();
    await section.getByLabel("Variante Info").selectOption("ping");
    await section.getByRole("button", { name: "Vorschau Info" }).click();
    expect((await spy(app)).oscs, "Vorschau spielt sofort").toBeGreaterThan(0);
    await app.reload();
    const section2 = app.locator("[data-testid=settings-sounds]");
    await expect(section2.getByRole("switch", { name: "Ton Info" })).toBeChecked();
    await expect(section2.getByLabel("Variante Info")).toHaveValue("ping");
    expect(await app.evaluate(() => JSON.parse(localStorage.getItem("ancientvoid.sounds") ?? "{}").categories?.info?.variant)).toBe("ping");
  });

  test("Rate-Limit: zwei Fehler-Meldungen dicht nacheinander lassen den zweiten Ton aus", async ({ app, hub }) => {
    await installAudioSpy(app);
    await app.keyboard.press("Escape"); // Geste, damit der Spieler überhaupt darf
    await hub.createSession({ adapter: "opencode", prompt: "Bitte KONTINGENT" });
    await expect.poll(async () => (await spy(app)).oscs, { timeout: 20_000 }).toBeGreaterThan(0);
    const afterFirst = (await spy(app)).oscs;
    await hub.createSession({ adapter: "opencode", prompt: "Bitte KONTINGENT" });
    await app.waitForTimeout(12_000);
    expect((await spy(app)).oscs, "zweite Fehler-Meldung im 10-Sekunden-Fenster bleibt stumm").toBe(afterFirst);
  });
});
