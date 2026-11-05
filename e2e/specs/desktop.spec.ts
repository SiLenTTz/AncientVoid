import { test, expect } from "../support/fixtures.ts";
import { Companion, type FocusBackend, type FocusInfo, type InputBackend } from "../../apps/companion/src/companion.ts";

/**
 * EPIC-P11 (ADR-0031): typing on the PC from the phone. A real companion
 * (its code, its protocol) against the test hub; only the desktop is a
 * stand-in — no real window of this machine is ever touched.
 */
class FakeDesktop implements FocusBackend, InputBackend {
  readonly name = "hyprland";
  current: FocusInfo | null = { id: "w1", app: "foot", title: "~/projekt — bash", pid: 1 };
  typed = "";
  keys: string[] = [];
  keyGate: Promise<void> = Promise.resolve();
  inputModes: string[] = [];
  targets: (string | undefined)[] = [];
  async focus() {
    return this.current;
  }
  async locked() {
    return false;
  }
  async type(text: string, _signal?: AbortSignal, targetId?: string, mode = "keystroke") {
    this.typed += text;
    this.inputModes.push(mode);
    this.targets.push(targetId);
  }
  async key(key: string) {
    await this.keyGate;
    this.keys.push(key);
  }
  async selectAll() {
    this.keys.push("ctrl+a");
  }
}

test.describe("Am PC eintippen (EPIC-P11)", () => {
  test("Ziel sehen, Text eintippen, Taste senden; Fokuswechsel, Passwortfenster und Not-Stopp verhindern das Tippen", async ({ app, hub }) => {
    const desk = new FakeDesktop();
    const companion = new Companion({ hub: hub.origin, token: hub.extraToken("companion:e2e-pc"), focus: desk, input: desk, focusMs: 30 });
    const running = companion.run();
    let releaseKey = () => {};
    try {
      await app.getByRole("button", { name: "PC", exact: true }).click();
      await expect(app).toHaveURL(/#\/pc$/);
      await expect(app.locator(".desktop-focus")).toContainText("foot — ~/projekt — bash");
      await expect(app.locator(".desktop-head")).toContainText("verbunden");
      await app.getByLabel("Text für den PC").fill("npm test -- --run äöü");
      await expect(app.getByRole("button", { name: "Eintippen" })).toBeDisabled();
      await expect(app.locator(".desktop-input")).toContainText("bis du das adressierte Einfügen ausdrücklich einschaltest");
      await app.getByLabel(/Gezielt einfügen/).check();
      await app.getByRole("button", { name: "Eintippen" }).click();
      await expect(app.locator(".desktop-action").first()).toContainText("fertig");
      await expect(app.locator(".desktop-action").first()).toContainText("21 Zeichen in foot getippt");
      expect(desk.typed).toBe("npm test -- --run äöü");
      expect(desk.inputModes).toEqual(["targeted-paste"]);
      expect(desk.targets).toEqual(["w1"]);

      await app.getByLabel(/Gezielt einfügen/).uncheck();
      await expect(app.getByRole("button", { name: "Eintippen" })).toBeDisabled();
      await app.getByLabel(/Gezielt einfügen/).check();
      await app.getByLabel("Text für den PC").fill("zielgenau");
      await app.getByRole("button", { name: "Eintippen" }).click();
      await expect(app.locator(".desktop-action").first()).toContainText("fertig");
      expect(desk.typed).toBe("npm test -- --run äöüzielgenau");
      expect(desk.inputModes).toEqual(["targeted-paste", "targeted-paste"]);
      expect(desk.targets).toEqual(["w1", "w1"]);
      desk.keyGate = new Promise<void>(resolve => { releaseKey = resolve; });
      await app.getByRole("button", { name: "↵ Enter" }).click();
      await expect(app.locator(".desktop-action").first()).toContainText("Taste Return");
      releaseKey();
      await expect(app.locator(".desktop-action").first()).toContainText("fertig");
      expect(desk.keys).toEqual(["Return"]);

      // Focus moves between what the page shows and the tap: nothing is typed.
      await app.getByLabel("Text für den PC").fill("geheim");
      desk.current = { id: "w2", app: "org.telegram.desktop", title: "Chat", pid: 2 };
      await app.getByRole("button", { name: "Eintippen" }).click();
      await expect(app.locator(".desktop-page")).toContainText(/Fokus (am PC )?hat sich (seit der Vorschau )?geändert/);
      expect(desk.typed).not.toContain("geheim");
      await expect(app.locator(".desktop-focus")).toContainText("org.telegram.desktop — Chat");
      // BUG-0047: refused at the PC or by the hub — either way the person's text is still there.
      await expect(app.getByLabel("Text für den PC")).toHaveValue("geheim");

      // A password manager has the focus: the page says so, the buttons are off.
      desk.current = { id: "w3", app: "org.keepassxc.KeePassXC", title: "Datenbank entsperren", pid: 3 };
      await expect(app.locator(".desktop-target")).toContainText("Passwort");
      await expect(app.getByRole("button", { name: "Eintippen" })).toBeDisabled();

      // Emergency stop at the PC.
      desk.current = { id: "w1", app: "foot", title: "~/projekt — bash", pid: 1 };
      companion.stop();
      await expect(app.locator(".desktop-target")).toContainText("Not-Stopp am PC aktiv");
      await expect(app.getByRole("button", { name: "Eintippen" })).toBeDisabled();
      companion.resume();
      await expect(app.getByRole("button", { name: "Eintippen" })).toBeEnabled();
      expect(desk.typed).toBe("npm test -- --run äöüzielgenau");
    } finally {
      releaseKey();
      companion.shutdown();
      await running.catch(() => undefined);
    }
  });

  test("ohne Companion: die Seite erklärt die Einrichtung", async ({ app }) => {
    await app.getByRole("button", { name: "PC", exact: true }).click();
    await expect(app.locator(".desktop-setup")).toContainText("Kein PC verbunden");
    await expect(app.locator(".desktop-setup")).toContainText("ancientvoid-companion stop");
  });
});
