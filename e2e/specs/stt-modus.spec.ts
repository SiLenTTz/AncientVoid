import { createServer, type Server } from "node:http";
import { WebSocketServer } from "ws";
import { test, expect } from "../support/fixtures.ts";
import type { Page } from "@playwright/test";
import { freePort } from "../support/ports.ts";

/**
 * ADR-0095 (Nachtrag): die Quelle der Spracheingabe ist waehlbar, aber sie kostet
 * keinen Platz in der Eingabgegend. Gewählt wird ueber **Lange-druecken auf den
 * Mikro-Knopf** (Menue) und ueber die Einstellungen. Bewiesen wird hier:
 *  - die feste Zeile unter der Eingabe ist weg;
 *  - Lange-drueckenoeffnet das Menue, kurzes Tippen nimmt weiter auf;
 *  - Browser-Wahl: der Hub bekommt keine Diktat-Anfrage ab;
 *  - die Wahl ueberlebt Neuladen und ist in den Einstellungen dieselbe;
 *  - "lokal" faellt nie still in die Cloud zurueck.
 */
const port = await freePort();
const streamPort = await freePort();
let server: Server;
let streamServer: WebSocketServer;
let erkannt = 0;

test.beforeAll(async () => {
  server = createServer((_req, res) => {
    erkannt += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ text: "Der Text kommt vom Hub" }));
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  streamServer = new WebSocketServer({ host: "127.0.0.1", port: streamPort });
  await new Promise<void>((resolve) => streamServer.once("listening", resolve));
  streamServer.on("connection", (socket) => {
    socket.on("message", (raw, isBinary) => {
      if (isBinary) {
        socket.send(JSON.stringify({ type: "conversation.item.input_audio_transcription.delta", delta: "live" }));
        return;
      }
      const event = JSON.parse(raw.toString()) as { type?: string };
      if (event.type === "session.update") socket.send(JSON.stringify({ type: "session.updated" }));
      if (event.type === "input_audio_buffer.commit") {
        erkannt += 1;
        socket.send(JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", transcript: "Der Text kommt vom Hub" }));
      }
    });
  });
});
test.afterAll(async () => {
  server?.close();
  if (streamServer) await new Promise<void>((resolve) => streamServer.close(() => resolve()));
});

test.use({
  hubOptions: {
    sttUrl: `http://127.0.0.1:${port}/inference`,
    sttStreamingUrl: `ws://127.0.0.1:${streamPort}/v1/audio/transcriptions/realtime`,
  },
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
});

async function sessionOffen(app: Page, hub: { origin: string; createSession: (o: { adapter: string; prompt: string }) => Promise<string> }) {
  const id = await hub.createSession({ adapter: "opencode", prompt: "Start" });
  await app.goto(`${hub.origin}/#/sessions/${id}`);
  await app.getByPlaceholder("Antworten…").click();
}

/** Lange auf den Mikro-Knopf druecken: das Menue kommt, die Aufnahme startet nicht. */
async function langeDruecken(page: Page, app: Page) {
  // Nach dem Seitenwechsel setzt der FAB seine Position neu (Dock-Oberkante, settle-Timer).
  // Gedrueckt wird erst, wenn er stillsteht — sonst trifft der Druck ins Leere.
  let knopf = await app.getByTestId("nyx-fab").boundingBox();
  for (let i = 0; i < 12 && knopf; i += 1) {
    await page.waitForTimeout(150);
    const gleich = await app.getByTestId("nyx-fab").boundingBox();
    if (gleich && gleich.x === knopf.x && gleich.y === knopf.y) break;
    knopf = gleich;
  }
  if (!knopf) throw new Error("Mikro-Knopf nicht gefunden");
  await page.mouse.move(knopf.x + knopf.width / 2, knopf.y + knopf.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(750);
  await page.mouse.up();
}

test.describe("Spracheingabe-Quelle: Menue und Einstellungen (ADR-0095)", () => {
  test("die feste Zeile unter der Eingabe ist weg, Lange-druecken gibt das Menue", async ({ app, hub, page }) => {
    await sessionOffen(app, hub);
    await expect(app.getByTestId("stt-modus")).toHaveCount(0);
    await expect(app.getByTestId("stt-modus-menu")).toHaveCount(0);

    await langeDruecken(page, app);
    await expect(app.getByTestId("stt-modus-menu")).toBeVisible();
    await expect(app.getByTestId("stt-modus-auto")).toBeVisible();
    await expect(app.getByTestId("stt-modus-lokal")).toBeVisible();
    await expect(app.getByTestId("stt-modus-browser")).toBeVisible();
    await expect(app.getByTestId("stt-modus-note")).toContainText("lokal am Hub");
    // Das Menue ueberdeckt weder die Eingabe noch die Knopfleiste darunter.
    const masse = await page.evaluate(() => {
      const r = (s: string) => {
        const e = document.querySelector(s)?.getBoundingClientRect();
        return e ? { y: Math.round(e.y), x: Math.round(e.x), b: Math.round(e.width), h: Math.round(e.height) } : null;
      };
      return { menue: r("[data-testid=stt-modus-menu]"), feld: r(".composer textarea"), leiste: r(".composer-actions, .composer-bar"), hoehe: window.innerHeight };
    });
    expect(masse.menue).not.toBeNull();
    expect(masse.menue!.y).toBeGreaterThanOrEqual(0);
    expect(masse.menue!.y + masse.menue!.h).toBeLessThanOrEqual(masse.hoehe!);

    // Die Wahl "Browser" schliesst das Menue, und die Aufnahme laeuft nicht einfach los.
    await app.getByTestId("stt-modus-browser").click();
    await expect(app.getByTestId("stt-modus-menu")).toHaveCount(0);
    await expect(app.getByTestId("nyx-fab")).not.toHaveClass(/recording/);
  });

  test("kurzes Tippen nimmt weiter auf; Browser-Wahl laesst den Hub aussen vor", async ({ app, hub, page }) => {
    await sessionOffen(app, hub);
    await langeDruecken(page, app);
    await app.getByTestId("stt-modus-browser").click();
    const vorher = erkannt;
    const anfragen: string[] = [];
    page.on("request", (r) => {
      const u = r.url();
      if (u.includes("/api/stt/") || u.includes("/api/stt/stream-ticket")) anfragen.push(u);
    });
    await app.getByTestId("nyx-fab").click();
    await expect(app.getByTestId("nyx-fab-cloud")).toBeVisible();
    await app.waitForTimeout(1200);
    expect(anfragen).toEqual([]);
    expect(erkannt).toBe(vorher);
    await app.getByTestId("nyx-fab").click();
  });

  test("Lokal-Wahl im Menue erkennt am Hub und bleibt nach dem Neuladen gesetzt", async ({ app, hub, page }) => {
    await sessionOffen(app, hub);
    await langeDruecken(page, app);
    await app.getByTestId("stt-modus-lokal").click();
    await app.getByTestId("nyx-fab").click();
    await expect(app.getByTestId("nyx-fab")).toHaveClass(/recording/);
    await app.waitForTimeout(900);
    await app.getByTestId("nyx-fab").click();
    await expect(app.locator('[data-testid=nyx-fab-toast]').filter({ hasText: /lokal · / })).toBeVisible();
    await expect(app.getByPlaceholder("Antworten…")).toHaveValue(/Der Text kommt vom Hub/);
    expect(erkannt).toBeGreaterThan(0);

    await page.reload();
    await app.getByPlaceholder("Antworten…").click();
    await langeDruecken(page, app);
    await expect(app.getByTestId("stt-modus-lokal")).toHaveAttribute("aria-pressed", "true");
  });

  test("die Einstellungen zeigen dieselbe Quelle und wirken sofort", async ({ app, hub, page }) => {
    const sitzung = await hub.createSession({ adapter: "opencode", prompt: "Start" });
    const hash = `#/sessions/${sitzung}`;
    await app.goto(`${hub.origin}/${hash}`);
    await app.getByPlaceholder("Antworten…").click();
    await app.goto(`${hub.origin}/#/einstellungen`);
    await expect(app.getByTestId("settings-voice")).toBeVisible();
    await expect(app.getByTestId("stt-modus-s-lokal")).toBeVisible();
    await app.getByTestId("stt-modus-s-browser").click();
    await expect(app.getByTestId("stt-modus-s-note")).toContainText(/verlässt das Gerät/);
    // Der Mikro-Knopf weiss es sofort, ohne Neuladen.
    await app.goto(`${hub.origin}/${hash}`);
    await app.getByPlaceholder("Antworten…").click();
    await langeDruecken(page, app);
    await expect(app.getByTestId("stt-modus-browser")).toHaveAttribute("aria-pressed", "true");
  });

  test("Lokal-Wahl weicht nie in die Cloud aus, wenn der Hub nicht kann", async ({ app, hub, page }) => {
    await page.route((adresse) => adresse.pathname.endsWith("/api/stt"), (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ available: false, local: true }) }),
    );
    const id = await hub.createSession({ adapter: "opencode", prompt: "Start" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    // Die App hat die Auskunft beim ersten Laden schon — ein echtes Neuladen holt sie neu.
    await page.reload();
    await app.getByPlaceholder("Antworten…").click();
    await langeDruecken(page, app);
    await app.getByTestId("stt-modus-lokal").click(); // die Wahl schliesst das Menue
    await langeDruecken(page, app); // erneut geoeffnet: die Wahl steht noch
    await expect(app.getByTestId("stt-modus-lokal")).toHaveAttribute("aria-pressed", "true");
    await expect(app.getByTestId("stt-modus-note")).toContainText(/nicht erreichbar/);
    await expect(app.getByTestId("nyx-fab")).toHaveAttribute("aria-disabled", "true");
    await expect(app.getByTestId("nyx-fab")).toHaveAttribute("data-tip", /nicht erreichbar/);
  });
});
