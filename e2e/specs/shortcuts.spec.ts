import { installSpeechRecognition } from "../support/speech.ts";
import { test, expect } from "../support/fixtures.ts";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

/** EPIC-P51: keyboard shortcuts exercise real UI focus and actions.
 * Speech uses a controlled browser recognizer; local audio conversion is covered
 * separately by voice-local.spec.ts. */
test.describe("Esc schließt Overlays und gibt den Fokus zurück (EPIC-P51 T51.6)", () => {
  test("Befehlsleiste: Esc schließt, Fokus zurück auf den Auslöser", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Kurz" });
    await app.locator(".dock .dock-item").nth(1).click(); // „Suchen“
    await expect(app.locator(".command-sheet")).toBeVisible();
    await expect(app.locator(".command-sheet input")).toBeFocused();
    await app.keyboard.press("Escape");
    await expect(app.locator(".command-sheet")).toHaveCount(0);
    // toBeFocused pollt: der Fokus-Rückgabe-Cleanup läuft erst mit dem nächsten Effekt-Flush (preact).
    await expect(app.locator(".dock .dock-item").nth(1)).toBeFocused();
  });

  test("Skill-/Agenten-Auswahl: Esc schließt, Fokus zurück auf den Chip", async ({ app, hub }) => {
    await app.goto(`${hub.origin}/#/neu`);
    await app.getByLabel("Adapter").selectOption("claude");
    const chip = app.locator("button.skill-chip").first();
    await expect(chip).toBeVisible();
    await chip.click();
    await expect(app.locator(".ui-sheet")).toBeVisible();
    // Fokus-Rein-Behauptung wartet zugleich, bis der Registry-Effekt gespült ist (preact).
    await expect(app.locator(".ui-sheet .ui-button").first()).toBeFocused();
    await app.keyboard.press("Escape");
    await expect(app.locator(".ui-sheet")).toHaveCount(0);
    await expect(app.locator("button.skill-chip").first()).toBeFocused();
  });

  test("Benachrichtigungs-Panel: Esc schließt, Fokus zurück auf die Glocke", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Kurz" });
    await app.getByRole("button", { name: /Benachrichtigungen/ }).click();
    await expect(app.locator(".notif-panel")).toBeVisible();
    await expect(app.locator(".notif-panel-head").getByRole("button", { name: "✕" })).toBeFocused();
    await app.keyboard.press("Escape");
    await expect(app.locator(".notif-panel")).toHaveCount(0);
    await expect(app.locator(".notif-bell")).toBeFocused();
  });
});

test.describe("Sprachdiktat stoppen (EPIC-P51 T51.6, BUG-0177)", () => {
  test.beforeEach(async ({ page }) => installSpeechRecognition(page));
  test("Esc stoppt das Diktat und behält den gehörten Text", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Kurz" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    const fab = app.locator('[data-testid=nyx-fab]');
    await expect(fab).toBeVisible();
    await app.getByPlaceholder("Antworten…").click();
    await fab.click();
    await expect(fab).toHaveAttribute("aria-pressed", "true");
    await expect(app.getByTestId("nyx-fab-words")).toHaveText("stopp");
    await app.keyboard.press("Escape");
    await expect(fab).toHaveAttribute("aria-pressed", "false");
    await expect(app.getByPlaceholder("Antworten…")).toHaveValue("stopp");
    await expect(app.getByTestId("nyx-fab-toast")).toContainText("Diktat");
  });
});

test.describe("Globale View-Wechsel-Kürzel (EPIC-P51 T51.6)", () => {
  test("Alt+Pos1 springt zur Übersicht, Alt+←/→ laufen die Historie entlang", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Kurz" });
    await app.goto(`${hub.origin}/#/`);
    await app.locator(".session-card .session-open").first().click();
    await expect(app.locator(".session-topbar, [data-tile='1'] .session-top-title")).toBeVisible();
    await app.keyboard.press("Alt+Home");
    await expect(app).toHaveURL(/#\/$/);
    await expect(app.locator(".session-card").first()).toBeVisible();
    await app.keyboard.press("Alt+ArrowLeft");
    await expect(app).toHaveURL(new RegExp(`#/sessions/${id}`));
    await app.keyboard.press("Alt+ArrowRight");
    await expect(app).toHaveURL(/#\/$/);
  });
});

test.describe("?-Kürzelübersicht (EPIC-P51 T51.7, aus T43.6 gezogen)", () => {
  test("? zeigt die Übersicht aus der Registry; Esc schließt", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Kurz" });
    await app.keyboard.press("Shift+Slash");
    const sheet = app.locator(".cheatsheet");
    await expect(sheet).toBeVisible();
    await expect(app.locator(".cheatsheet-key").filter({ hasText: "Strg+K" })).toBeVisible();
    await expect(app.locator(".cheatsheet-key").filter({ hasText: /^Alt\+1$/ })).toBeVisible();
    await expect(app.locator(".cheatsheet-key").filter({ hasText: "Strg+Enter" })).toBeVisible();
    await app.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
  });

  test("? wirkt nicht im Eingabefeld (kein Öffnen beim Tippen)", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Kurz" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByPlaceholder("Antworten…").fill("Frage? Ja");
    await expect(app.locator(".cheatsheet")).toHaveCount(0);
    await expect(app.getByPlaceholder("Antworten…")).toHaveValue("Frage? Ja");
  });
});

test.describe("Shortcut-Hinweis-Pill und Setting (EPIC-P51 T51.8)", () => {
  test("Klick auf eine Aktion mit Kürzel zeigt die Pill kurz, dann verschwindet sie", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Kurz" });
    await app.locator(".dock .dock-item").nth(1).click(); // „Suchen“ → Strg+K
    const pill = app.locator('[data-testid=shortcut-hint]');
    await expect(pill).toBeVisible();
    await expect(pill).toHaveText("Strg+K");
    await app.keyboard.press("Escape"); // CommandBar schließen
    await expect(pill).toBeHidden({ timeout: 6000 });
  });

  test("Klick ohne Kürzel bleibt still", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Kurz" });
    await app.locator(".dock .dock-item").first().click(); // „Start“ hat kein Kürzel
    await app.waitForTimeout(350);
    await expect(app.locator('[data-testid=shortcut-hint]')).toHaveCount(0);
  });

  test("Setting aus: keine Pill, nichts blockiert", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Kurz" });
    await app.evaluate(() => localStorage.setItem("ancientvoid.shortcutHints", "0"));
    await app.reload();
    await app.locator(".dock .dock-item").nth(1).click();
    await app.waitForTimeout(350);
    await expect(app.locator('[data-testid=shortcut-hint]')).toHaveCount(0);
    await app.keyboard.press("Escape");
    await expect(app.locator(".command-sheet")).toHaveCount(0);
  });

  test("Setting-Schalter in der Darstellungsgruppe schaltbar (role=switch)", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Kurz" });
    await app.goto(`${hub.origin}/#/einstellungen`);
    const sw = app.getByRole("switch", { name: "Shortcut-Hinweise" });
    await expect(sw).toBeVisible();
    await sw.click();
    await expect(sw).not.toBeChecked();
    expect(await app.evaluate(() => localStorage.getItem("ancientvoid.shortcutHints"))).toBe("0");
    await sw.click();
    await expect(sw).toBeChecked();
    expect(await app.evaluate(() => localStorage.getItem("ancientvoid.shortcutHints"))).toBe(null);
  });

  test("Pill blockiert nichts: pointer-events none (Premortem 4)", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Kurz" });
    await app.locator(".dock .dock-item").nth(1).click(); // „Suchen“ erzeugt die Pill
    // Ein einziger Roundtrip direkt nach dem Klick: die Pill steht nur ~2 s —
    // ein Assert-Retry unter Volllast verpasste im ersten Lauf das Zeitfenster.
    const pe = await app.evaluate(() => {
      const el = document.querySelector('[data-testid=shortcut-hint]');
      return el ? getComputedStyle(el).pointerEvents : "(Pill fehlt)";
    });
    expect(pe).toBe("none");
    // Fokus-Rein-Behauptung wartet den Effekt-Flush mit, bevor Esc die Leiste
    // schließt (gleiche Lektion wie SkillPicker-Test: Registry-Registrierung
    // hängt im selben Flush wie der Fokus).
    await expect(app.locator(".command-sheet input")).toBeFocused();
    await app.keyboard.press("Escape");
    await expect(app.locator(".command-sheet")).toHaveCount(0);
  });
});

test.describe("Roving-Pfeil-Navigation (EPIC-P51 T51.6)", () => {
  test("Dock: Pfeiltasten bewegen den Fokus von Eintrag zu Eintrag", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Kurz" });
    await app.locator(".dock .dock-item").first().evaluate((el) => (el as HTMLElement).focus());
    await expect(app.locator(".dock .dock-item").first()).toBeFocused();
    await app.keyboard.press("ArrowRight");
    await expect(app.locator(".dock .dock-item").nth(1)).toBeFocused();
    await app.keyboard.press("ArrowLeft");
    await expect(app.locator(".dock .dock-item").first()).toBeFocused();
  });

  test("Session-Liste: ↑/↓ springen zwischen Karten", async ({ app, hub }) => {
    await hub.createSession({ adapter: "opencode", prompt: "Erste" });
    await hub.createSession({ adapter: "opencode", prompt: "Zweite" });
    const cards = app.locator(".session-card");
    await expect(cards.nth(1)).toBeVisible();
    await cards.nth(0).evaluate((el) => (el as HTMLElement).focus());
    await cards.nth(0).waitFor();
    await app.keyboard.press("ArrowDown");
    await expect(cards.nth(1)).toBeFocused();
    await app.keyboard.press("ArrowUp");
    await expect(cards.nth(0)).toBeFocused();
  });

  test("Vault-Liste: ↑/↓ springen zwischen Notizen", async ({ app, hub }) => {
    const vaultDir = join(hub.projectsDir, "notizen-vault");
    mkdirSync(vaultDir, { recursive: true });
    await app.goto(`${hub.origin}/#/notizen`);
    await app.getByRole("button", { name: "📁 projects" }).click();
    await app.getByRole("button", { name: "📁 notizen-vault" }).click();
    await app.locator('[data-testid=vault-choose]').click();
    await app.getByLabel("Neue Notiz").fill("Alpha");
    await app.getByRole("button", { name: "Anlegen" }).click();
    await expect(app.locator(".vault-row").filter({ hasText: "Alpha.md" })).toBeVisible();
    await app.getByLabel("Neue Notiz").fill("Beta");
    await app.getByRole("button", { name: "Anlegen" }).click();
    const rows = app.locator(".vault-row");
    await rows.nth(0).click();
    await rows.nth(0).waitFor();
    await app.keyboard.press("ArrowDown");
    await expect(rows.nth(1)).toBeFocused();
    await app.keyboard.press("ArrowUp");
    await expect(rows.nth(0)).toBeFocused();
  });
});
