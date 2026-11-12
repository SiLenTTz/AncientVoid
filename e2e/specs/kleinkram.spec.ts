import type { Page } from "@playwright/test";
import { test, expect, sessionTab, dockGo } from "../support/fixtures.ts";
import type { TestHub } from "../support/hub.ts";

/**
 * EPIC-P43 T43.5: die sieben Kleinkram-Regeln (Design-Review §4.3), je Regel ein Test.
 */
async function idleSession(app: Page, hub: TestHub, prompt: string): Promise<string> {
  const id = await hub.createSession({ adapter: "opencode", prompt });
  await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "Zug fertig");
  await app.goto(`${hub.origin}/#/sessions/${id}`);
  await expect(app.locator(".session-live, .tile").first()).toBeVisible();
  return id;
}

/** Sichtbare Tasten einer Fläche: Name, Text, aria-label, title. */
async function buttons(app: Page) {
  return app.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("button, [role='button'], summary")]
      .filter((b) => {
        const r = b.getBoundingClientRect();
        const cs = getComputedStyle(b);
        return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && Number(cs.opacity) > 0;
      })
      .map((b) => ({
        html: b.outerHTML.slice(0, 120),
        text: (b.textContent ?? "").trim(),
        label: b.getAttribute("aria-label") ?? "",
        title: b.getAttribute("title") ?? "",
      })),
  );
}

test.describe("Kleinkram-Regeln (EPIC-P43 T43.5)", () => {
  test("Regel 1: Unbekanntes schweigt in der Leiste und steht im Bericht", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await expect(app.locator(".session-top-title").first()).toBeVisible();
    await expect(app.locator(".run-strip").first()).not.toContainText("unbekannt");
    await sessionTab(app, "Bericht");
    await expect(app.locator(".kv-row").filter({ hasText: "Kontextfenster" })).toContainText("keine Meldung");
    await expect(app.locator(".kv-row").filter({ hasText: "Kontingent" })).toContainText(/unbekannt|keine Meldung/);
  });

  test("Regel 2: leere Reiter rücken unter „Mehr“ und sagen in einem Satz, was fehlt — mit einer Aktion", async ({ app, hub }) => {
    await idleSession(app, hub, "Nur lesen");
    const bar = app.locator(".subtabs-wrap").first();
    await expect(bar.getByRole("button", { name: /^Änderungen/ })).toHaveCount(0);
    await sessionTab(app, "Änderungen");
    const empty = app.locator(".empty-state").first();
    await expect(empty).toContainText("noch nichts geändert");
    await empty.getByRole("button", { name: "Zum Chat" }).click();
    await expect(bar.getByRole("button", { name: /^Chat/ })).toHaveAttribute("aria-current", "page");

    await sessionTab(app, "Datei");
    // „Datei“ öffnet den Dateibaum von selbst; die Fläche zeigt den Editor statt eines Knopfes.
    await expect(app.getByTestId("files-sidebar")).toBeVisible();
    await expect(app.locator(".code-pane").first()).toBeVisible();
  });

  test("Regel 3: Zeilenaktionen beim Überfahren, Fokus oder langem Drücken — und im Menü der Zeile", async ({ app, hub }) => {
    await hub.createSession({ adapter: "dummy", prompt: "Kartenaktion" });
    const card = app.locator(".session-card").filter({ hasText: "Kartenaktion" });
    const archive = card.locator(".session-card-actions").getByRole("button", { name: "Archivieren", exact: true });
    await expect(card).toHaveCount(1);
    // Touch am Gerät selbst ablesen — das echte Handy läuft als Projekt „phone“, nicht „mobile“.
    const touch = await app.evaluate(() => matchMedia("(hover: none)").matches);
    if (touch) {
      await expect(archive).toBeHidden();
      await card.locator(".session-open").dispatchEvent("contextmenu");
      await expect(archive).toBeVisible();
    } else {
      expect(await archive.evaluate((el) => getComputedStyle(el).opacity)).toBe("0");
      await card.hover();
      await expect.poll(() => archive.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
    }
    await card.locator(".row-menu-btn").click();
    await expect(card.getByRole("menu").getByRole("menuitem")).toHaveText(["Repo-Graph", "Anheften", "Archivieren"]);
    await card.getByRole("menuitem", { name: "Anheften" }).click();
    await expect(app.locator(".section-pins .session-card")).toHaveCount(1);
  });

  test("Regel 4: eine Hauptaktion je Ansicht, gefüllt, oben rechts", async ({ app, hub }) => {
    await idleSession(app, hub, "Lege eine DATEI an");
    await sessionTab(app, "Änderungen");
    const head = app.locator(".changes-head").first();
    await expect(head).toContainText("1 Datei");
    // Die Ansicht selbst — das Antwortfeld darunter mit „Senden“ gehört nicht zu ihr.
    await expect(app.locator(".tail-scroll").first().locator(".btn.primary")).toHaveCount(1);
    const primary = head.locator(".btn.primary");
    await expect(primary).toHaveText("Ins Projekt übernehmen");
    const [btn, box] = await Promise.all([primary.boundingBox(), head.boundingBox()]);
    expect(btn!.x + btn!.width).toBeGreaterThan(box!.x + box!.width - 4);
    // Der Bericht darunter trägt dieselbe Aktion nicht ein zweites Mal.
    await expect(app.locator(".changes-report").getByRole("button", { name: "Ins Projekt übernehmen" })).toHaveCount(0);
  });

  test("Regel 5: jede Taste trägt Worte oder ein Symbol mit aria-label und Tooltip", async ({ app, hub }) => {
    await idleSession(app, hub, "Tasten prüfen");
    const pages: (() => Promise<void>)[] = [
      async () => sessionTab(app, "Chat"),
      async () => sessionTab(app, "Befehle"),
      async () => {
        await app.goto(`${hub.origin}/#/`);
        await expect(app.locator(".dashboard")).toBeVisible();
      },
      async () => dockGo(app, "Einstellungen"),
    ];
    const bad: string[] = [];
    for (const show of pages) {
      await show();
      await app.waitForTimeout(300);
      for (const b of await buttons(app)) {
        const words = /[\p{L}\p{N}]{2,}/u.test(b.text);
        if (!words && !(b.label && b.title)) bad.push(b.html);
        if (!b.text && !b.label) bad.push(`ohne Namen: ${b.html}`);
      }
    }
    expect([...new Set(bad)]).toEqual([]);
  });

  test("Regel 6: nichts liegt über dem Inhalt", async ({ app, hub }) => {
    await idleSession(app, hub, "Nichts darüber");
    await sessionTab(app, "Chat");
    // Keine Randlaschen; der rechte Rand des Verlaufs gehört dem Verlauf.
    await expect(app.locator(".files-toggle, .browser-toggle, .device-toggle")).toHaveCount(0);
    const covered = await app.evaluate(() => {
      const scroll = document.querySelector(".tail-scroll");
      if (!scroll) return ["kein Verlauf"];
      const r = scroll.getBoundingClientRect();
      const hits: string[] = [];
      for (let y = r.top + 20; y < Math.min(r.bottom, innerHeight) - 20; y += 40) {
        const el = document.elementFromPoint(r.right - 6, y);
        if (el && !scroll.contains(el) && !el.contains(scroll)) hits.push(`${el.tagName}.${el.className}`);
      }
      return hits;
    });
    expect(covered).toEqual([]);
  });

  test("Regel 7: Formularelemente sind App-Bausteine, kein Browser-Standard", async ({ app, hub }) => {
    // Das Anlage-Formular trägt Auswahlfelder (Projekt, Adapter) und das Auftragsfeld; die Session das Antwortfeld.
    const check = () => app.evaluate(() => {
      const font = getComputedStyle(document.body).fontFamily;
      const bad: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>("select, input[type=text], input[type=search], input:not([type]), textarea")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const cs = getComputedStyle(el);
        if (cs.fontFamily !== font) bad.push(`Schrift ${el.tagName}: ${cs.fontFamily}`);
        if (el.tagName === "SELECT" && cs.appearance !== "none") bad.push(`Auswahl im Browser-Stil: ${el.outerHTML.slice(0, 80)}`);
        if (cs.backgroundColor === "rgb(255, 255, 255)" && document.documentElement.dataset.theme !== "light") bad.push(`weißes Feld: ${el.outerHTML.slice(0, 80)}`);
      }
      return bad;
    });
    await app.getByRole("button", { name: "Neue Session" }).click();
    await expect(app.getByLabel("Adapter")).toBeVisible();
    const offCreate = await check();
    await idleSession(app, hub, "Formulare");
    await sessionTab(app, "Chat");
    await expect(app.locator(".dock-stack textarea, .composer textarea").first()).toBeVisible();
    expect([...offCreate, ...(await check())]).toEqual([]);
  });
});
