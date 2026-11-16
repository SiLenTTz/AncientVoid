import { test, expect, dockGo, sessionTab } from "../support/fixtures.ts";
import type { Page } from "@playwright/test";

/**
 * EPIC-P58: Typwriter-Effekt — Chat-Output und Thinking werden bei neuem Live-Zuwachs getippt,
 * History rendert sofort, Reduce Motion und der Hauptschalter gewinnen immer. Der Fixture setzt den
 * Schalter für die Suite auf aus (Determinismus); dieser Spec schaltet ihn über die Einstellungen an.
 * Der dummy-Adapter schreibt weiter, solange die Session läuft — daran lässt sich Live-Zuwachs messen.
 */

async function openSettings(app: Page): Promise<void> {
  await dockGo(app, "Einstellungen");
  await expect(app.getByRole("switch", { name: "Typwriter-Effekt" })).toBeVisible();
}

const typewriterSwitch = (app: Page) => app.getByRole("switch", { name: "Typwriter-Effekt" });

/** Beobachtet `ms` lang die sichtbaren Textlängen je Ereignis; true, wenn irgendeine Zeile ihre
 * Länge verändert hat — das passiert nur beim Tippen (History und Aus bleiben statisch). */
async function growthObserved(app: Page, ms = 6_000): Promise<boolean> {
  return app.evaluate(async (ms) => {
    const seen = new Map<string, Set<number>>();
    const snap = () => {
      for (const el of document.querySelectorAll(".event.assistant .summary, .event.thinking .summary, .turn-note.assistant .turn-note-toggle, .turn-note.thinking .turn-note-toggle")) {
        const seq = el.closest("[data-seq]")?.getAttribute("data-seq");
        if (!seq) continue;
        const set = seen.get(seq) ?? new Set<number>();
        set.add((el.textContent ?? "").length);
        seen.set(seq, set);
      }
    };
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      snap();
      await new Promise((r) => setTimeout(r, 40));
    }
    return [...seen.values()].some((lengths) => lengths.size > 1);
  }, ms);
}

test.describe("Typwriter-Effekt (EPIC-P58)", () => {
  test("Schalter an: neuer Live-Zuwachs wird getippt (AC-P58-1)", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy", prompt: "Typwriter an" });
    await openSettings(app);
    await typewriterSwitch(app).click();
    await expect(typewriterSwitch(app)).toBeChecked();
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await sessionTab(app, "Chat");
    await expect(app.locator(".event.assistant, .event.thinking").first()).toBeVisible({ timeout: 15_000 });
    expect(await growthObserved(app)).toBe(true);
  });

  test("Schalter aus (.fixture-Baseline): es wird nichts getippt, alles steht sofort", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy", prompt: "Typwriter aus" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await sessionTab(app, "Chat");
    await expect(app.locator(".event.assistant, .event.thinking").first()).toBeVisible({ timeout: 15_000 });
    expect(await growthObserved(app)).toBe(false);
  });

  test("die Schalterwahl überlebt einen Reload (AC-P58-1)", async ({ app, hub }) => {
    await hub.createSession({ adapter: "dummy", prompt: "Persistenz" });
    await openSettings(app);
    await typewriterSwitch(app).click();
    await expect(typewriterSwitch(app)).toBeChecked();
    await app.reload();
    await openSettings(app);
    await expect(typewriterSwitch(app)).toBeChecked();
    expect(await app.evaluate(() => localStorage.getItem("ancientvoid.typewriter"))).toBe("1");
  });

  test("Reduce Motion gewinnt auch bei eingeschaltetem Schalter (AC-P58-4)", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy", prompt: "Reduce Motion" });
    await openSettings(app);
    await typewriterSwitch(app).click();
    await expect(typewriterSwitch(app)).toBeChecked();
    await app.emulateMedia({ reducedMotion: "reduce" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await sessionTab(app, "Chat");
    await expect(app.locator(".event.assistant, .event.thinking").first()).toBeVisible({ timeout: 15_000 });
    expect(await growthObserved(app)).toBe(false);
  });

  test("History rendert sofort — was vor dem Öffnen schon da war, wird nicht nachgetippt (AC-P58-2)", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy", prompt: "History" });
    // Warten, bis genug Ereignisse deutlich älter als die Gnadenfrist (3 s) sind — die Margen
    // unten halten den Lade- und Navigationsaufwand raus, sonst misst man den Rand der Gnadenfrist.
    await hub.until(async () => {
      const events = await hub.events(id);
      return events.filter((e) => (["assistant", "thinking"] as string[]).includes(e.type) && Date.now() - Date.parse(e.ts) > 9_000).length >= 3;
    }, "drei alte Typwriter-Ereignisse", 40_000);
    await app.evaluate(() => localStorage.setItem("ancientvoid.typewriter", "1"));
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await sessionTab(app, "Chat");
    const events = await hub.events(id);
    // Nur Assistenten auf oberster Chat-Ebene (nach einem Werkzeugergebnis) werden als Zeile gezeigt —
    // frühere hängen in Arbeitsblöcken und wären für diesen Assert nicht sicher sichtbar.
    const old = events.filter((e, i) => e.type === "assistant" && events[i - 1]?.type === "tool_result" && Date.now() - Date.parse(e.ts) > 6_000);
    expect(old.length).toBeGreaterThanOrEqual(2);
    for (const e of old) {
      const row = app.locator(`.event.assistant[data-seq="${e.seq}"] .summary`).first();
      await expect(row).toBeVisible();
      // Sofort vollständig — kein Zwischenzustand, der später anders aussieht (K10-Geist).
      await expect(row).toHaveText(e.summary);
    }
  });
});
