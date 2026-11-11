import { test, expect, openFromOverview, openLayer } from "../support/fixtures.ts";
import { startScratch } from "../support/scratch-web.ts";
import type { Page } from "@playwright/test";
import type { TestHub } from "../support/hub.ts";

/**
 * EPIC-P39 T39.3/T39.4/T39.7 (ADR-0059): Browser-Arbeitsplatz gegen eine echte Scratch-Webapp und echtes Chromium.
 * Fehlt Chromium auf dem Host, meldet der Hub „nicht verfügbar“ — dann wird sichtbar übersprungen (Skip ≠ Pass).
 * Die Geräteabnahme (AC-P39-1) läuft als derselbe Spec im Projekt `phone` auf dem echten Handy (PHONE_SPECS).
 */
const scratch = await startScratch();
// Auf dem echten Handy (CDP-Projekt) ist alles träger: Chromium-Kaltstart des Hubs,
// JPEG-Standbild-Erneuerung, Touch-Roundtrips — 45 s reichen dort nicht.
test.beforeEach(() => test.setTimeout(process.env.ANCIENTVOID_E2E_CDP ? 180_000 : 60_000));
test.use({ hubOptions: { browserOrigins: [scratch.origin] } });

async function openBrowser(app: Page, hub: TestHub): Promise<string> {
  const id = await hub.createSession({ adapter: "dummy" });
  await openFromOverview(app, "dummy");
  await openLayer(app, "Browser");
  await expect(app.getByTestId("browser-context")).toContainText("dieser Host");
  return id;
}

async function start(app: Page, url: string): Promise<void> {
  await app.getByLabel("Adresse").fill(url);
  await app.getByRole("button", { name: "Browser starten" }).click();
}

test.describe("Browser-Arbeitsplatz (EPIC-P39)", () => {


  test("Scratch-App sehen, bedienen (Klick, Tippen, Viewport) und Zielgrenzen respektieren @desktop", async ({ app, hub }) => {
    const id = await openBrowser(app, hub);
    await expect(app.getByTestId("browser-origins")).toContainText(scratch.origin);
    await expect(app.getByTestId("browser-mode")).toContainText("headless");
    await start(app, `${scratch.origin}/`);
    const frame = app.getByTestId("browser-frame");
    await expect(frame).toBeVisible({ timeout: 30_000 });

    // Klick im Bild landet im Seitenkontext (Button links oben, 240×70 bei x=20,y=20)
    const box = (await frame.boundingBox())!;
    const natural = await frame.evaluate((el) => ({ w: (el as HTMLImageElement).naturalWidth, h: (el as HTMLImageElement).naturalHeight }));
    await app.mouse.click(box.x + (100 / natural.w) * box.width, box.y + (50 / natural.h) * box.height);
    await expect.poll(async () => (await hub.api<{ title: string }>(`/api/sessions/${id}/browser`)).body.title, { timeout: 15_000 }).toBe("Klicks: 1");

    // Tippen ins fokussierte Feld
    await app.mouse.click(box.x + (100 / natural.w) * box.width, box.y + (278 / natural.h) * box.height);
    await app.getByLabel("Text eintippen").fill("Anna");
    await app.getByRole("button", { name: "Tippen", exact: true }).click();
    await expect.poll(async () => (await hub.api<{ title: string }>(`/api/sessions/${id}/browser`)).body.title, { timeout: 15_000 }).toBe("Name: Anna");

    // Viewport: ehrlich als Fenstergröße beschriftet; Seitenverhältnis ändert sich
    await app.getByLabel("Fenstergröße").selectOption("phone");
    await expect.poll(async () => (await frame.evaluate((el) => (el as HTMLImageElement).naturalWidth)), { timeout: 15_000 }).toBe(390);

    // Zielgrenze: fremde Origin, Hub-URL und file: werden vor dem Netz abgewiesen
    for (const url of ["http://example.invalid/", hub.origin + "/api/sessions", "file:///etc/passwd"]) {
      await app.getByLabel("Adresse").fill(url);
      await app.getByRole("button", { name: "Gehe zu" }).click();
      await expect(app.locator(".files-error").first()).toContainText(/nicht freigegeben|nicht erlaubt|URL/, { timeout: 10_000 });
    }
    // Der Seiten-Subrequest auf example.invalid wurde blockiert und ist in der Konsole sichtbar
    await app.getByRole("tab", { name: /Konsole/ }).click();
    await expect(app.getByTestId("browser-log")).toContainText("example.invalid");
  });

  test("Testlauf: bestanden bei erfüllter Assertion, fehlgeschlagen bei Gegenprobe; Screenshot-Artefakt", async ({ app, hub }) => {
    await openBrowser(app, hub);
    await app.getByRole("tab", { name: "Tests" }).click();
    const editor = app.getByLabel("Testfall (JSON)");
    const run = async (steps: unknown[], name: string) => {
      await editor.fill(JSON.stringify({ name, viewport: "desktop", steps }));
      await app.getByTestId("browser-test-start").click();
    };
    await run([{ type: "goto", url: `${scratch.origin}/`, timeoutMs: 5000 }, { type: "click", selector: "#b", timeoutMs: 3000 }, { type: "expectText", selector: "#b", text: "Klicks: 1", timeoutMs: 3000 }], "Zähler zählt");
    await expect(app.locator('[data-testid="browser-run"]').filter({ hasText: "Zähler zählt" })).toHaveAttribute("data-state", "passed", { timeout: 30_000 });
    await run([{ type: "goto", url: `${scratch.origin}/`, timeoutMs: 5000 }, { type: "expectText", selector: "#b", text: "Klicks: 7", timeoutMs: 800 }], "Gegenprobe");
    const failed = app.locator('[data-testid="browser-run"]').filter({ hasText: "Gegenprobe" });
    await expect(failed).toHaveAttribute("data-state", "failed", { timeout: 30_000 });
    await expect(failed).toContainText("Klicks: 7");
    await failed.getByRole("button", { name: "Screenshot" }).click();
    await expect(failed.getByRole("img")).toBeVisible();
    // Ungültiger Testfall: verständliche Meldung, nichts läuft
    await editor.fill(JSON.stringify({ name: "x", steps: [{ type: "script", code: "1" }] }));
    await app.getByTestId("browser-test-start").click();
    await expect(app.getByRole("alert")).toContainText("Ungültiger Testfall");
  });

  test("zwei Sessions: getrennte Cookies, eigener Context je Session", async ({ hub }) => {
    const a = await hub.createSession({ adapter: "dummy" });
    const b = await hub.createSession({ adapter: "dummy" });
    expect((await hub.api(`/api/sessions/${a}/browser/open`, { body: { url: `${scratch.origin}/cookie-set` } })).status).toBe(200);
    expect((await hub.api(`/api/sessions/${b}/browser/open`, { body: { url: `${scratch.origin}/cookie-read` } })).status).toBe(200);
    // Seiteninhalt per Element-Auswahl lesen: b sieht den Cookie von a nicht, a sieht seinen eigenen
    const textAt = async (sid: string) => (await hub.api<{ text: string }>(`/api/sessions/${sid}/browser/pick`, { body: { x: 20, y: 25 } })).body.text;
    await expect.poll(() => textAt(b), { timeout: 20_000 }).toBe("leer");
    expect((await hub.api(`/api/sessions/${a}/browser/action`, { body: { action: { type: "navigate", url: `${scratch.origin}/cookie-read` } } })).status).toBe(200);
    await expect.poll(() => textAt(a), { timeout: 20_000 }).toContain("sess=geheim");
    expect(await textAt(b)).toBe("leer");
    // Eine fremde Session erreicht den Context nicht: unbekannte Session-ID → 404, kein Zugriff über andere IDs
    expect((await hub.api(`/api/sessions/${a}-fremd/browser`)).status).toBe(404);
    await hub.api(`/api/sessions/${a}/browser/close`, { body: {} });
    await hub.api(`/api/sessions/${b}/browser/close`, { body: {} });
  });

  test("Neustart während eines Laufs: Status unbekannt, keine Wiederholung", async ({ app, hub }) => {
    const id = await openBrowser(app, hub);
    const started = await hub.api<{ id: string }>(`/api/sessions/${id}/browser/tests`, { body: { test: { name: "hängt", viewport: "desktop", steps: [{ type: "goto", url: `${scratch.origin}/langsam`, timeoutMs: 5000 }, { type: "expectVisible", selector: "#gibtsnicht", timeoutMs: 10_000 }] } } });
    expect(started.status).toBe(202);
    await hub.restart("SIGKILL");
    const runs = await expect.poll(async () => (await hub.api<{ runs: { id: string; state: string; note: string | null }[] }>(`/api/sessions/${id}/browser/tests`)).body.runs.find((r) => r.id === started.body.id)?.state, { timeout: 30_000 }).toBe("unknown");
    void runs;
    const after = (await hub.api<{ runs: { id: string; note: string | null }[] }>(`/api/sessions/${id}/browser/tests`)).body.runs.find((r) => r.id === started.body.id);
    expect(after?.note).toContain("nichts wird wiederholt");
  });

  test("Browser-Panel als eigenes Fenster herauslösbar @desktop", async ({ app, hub, context }, testInfo) => {
    // Eigene Fenster sind ein Desktop-Konzept (ADR-0053): Android-Chrome öffnet Tabs statt
    // Fenster — das Fensterprotokoll (BroadcastChannel gleicher Origin) greift dort nicht.
    test.skip(testInfo.project.name === "phone", "Popout-Fenster sind Desktop; auf dem Handy öffnet Chrome Tabs.");
    const id = await openBrowser(app, hub);
    const popupP = context.waitForEvent("page");
    await app.getByRole("button", { name: "Browser in eigenes Fenster" }).click();
    const popup = await popupP;
    await popup.waitForLoadState();
    expect(popup.url()).toContain(`sessions/${id}/browser`);
    expect(popup.url()).not.toMatch(/token/i);
    await expect(popup.getByTestId("browser-panel")).toBeVisible();
    await expect(popup.getByTestId("browser-context")).toContainText("dieser Host");
    // Titel-Zeile: Browser-Fenster nennt sich so und trägt den Session-Titel (nicht „Session“ oder leer).
    await expect(popup.locator(".popout-title")).toContainText(/^⧉ Browser · \S+/);
    await expect(popup.locator(".popout-title")).not.toContainText("Browser · Session");
    // Eigenständig bedienbar: Navigation im Fenster, Standbild erscheint dort.
    await popup.getByLabel("Adresse").fill(`${scratch.origin}/`);
    await popup.getByRole("button", { name: "Browser starten" }).click();
    await expect(popup.getByTestId("browser-frame")).toBeVisible({ timeout: 30_000 });
    // Schlanke Hülle: kein Dock, keine Liste, keine Kachel-Leiste.
    await expect(popup.locator(".dock, .split-list, .tile-bar")).toHaveCount(0);
  });

  test("Latenzbudget: Start-zu-Bild und Klick-zu-Titel messen (K1/K2, T39.1)", async ({ app, hub }) => {
    const id = await openBrowser(app, hub);
    const t0 = Date.now();
    await start(app, `${scratch.origin}/`);
    const frame = app.getByTestId("browser-frame");
    await expect(frame).toBeVisible({ timeout: 30_000 });
    const tOpen = Date.now() - t0;
    const box = (await frame.boundingBox())!;
    const natural = await frame.evaluate((el) => ({ w: (el as HTMLImageElement).naturalWidth, h: (el as HTMLImageElement).naturalHeight }));
    const t1 = Date.now();
    await app.mouse.click(box.x + (100 / natural.w) * box.width, box.y + (50 / natural.h) * box.height);
    await expect.poll(async () => (await hub.api<{ title: string }>(`/api/sessions/${id}/browser`)).body.title, { timeout: 15_000 }).toBe("Klicks: 1");
    const tClick = Date.now() - t1;
    // Budget: interaktionsnah (Klick-Roundtrip inkl. Screenshot-Erneuerung) und Start unterhalb
    // grober Wahrnehmbarkeit — dokumentiert die T39.1-Messung je Laufumgebung (Desktop/Phone).
    expect(tOpen, `Start-zu-Bild ${tOpen} ms`).toBeLessThan(15_000);
    expect(tClick, `Klick-zu-Titel ${tClick} ms`).toBeLessThan(10_000);
    console.log(`P39-LATENZ start-zu-bild=${tOpen}ms klick-zu-titel=${tClick}ms`);
  });
});
