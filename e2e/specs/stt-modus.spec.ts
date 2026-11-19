import { createServer, type Server } from "node:http";
import { WebSocketServer } from "ws";
import { test, expect } from "../support/fixtures.ts";
import { freePort } from "../support/ports.ts";

/**
 * ADR-0094: welche Spracheingabe ein Geraet benutzt, ist waehlbar — Automatisch,
 * Lokal (Hub) oder Browser (meist Cloud). Bewiesen wird der Unterschied, den Kai
 * zwischen Handy und Tablet erlebt:
 *  - Browser-Wahl: der Hub sieht KEINE einzige Diktat-Anfrage;
 *  - Lokal-Wahl: der Hub sieht die Anfrage und liefert den Text;
 *  - die Wahl ueberlebt ein Neuladen, und "lokal" faellt nie still in die Cloud.
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

test.describe("Spracherkennung: Quelle pro Geraet (ADR-0094)", () => {
  test("die drei Quellen sind sichtbar und heiessen Automatisch, Lokal, Browser", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Start" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByPlaceholder("Antworten…").click();
    await expect(app.getByTestId("stt-modus")).toBeVisible();
    await expect(app.getByRole("button", { name: "Automatisch" })).toBeVisible();
    await expect(app.getByRole("button", { name: "Lokal" })).toBeVisible();
    await expect(app.getByRole("button", { name: "Browser" })).toBeVisible();
    await expect(app.getByRole("button", { name: "Automatisch" })).toHaveAttribute("aria-pressed", "true");
    await expect(app.getByTestId("stt-modus-note")).toContainText("lokal am Hub");
  });

  test("Browser-Wahl: der Hub bekommt keine Diktat-Anfrage ab", async ({ app, hub, page }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Start" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByPlaceholder("Antworten…").click();
    const anfragen: string[] = [];
    page.on("request", (r) => {
      const u = r.url();
      if (u.includes("/api/stt/") || u.includes("/api/stt/stream-ticket")) anfragen.push(u);
    });
    const vorher = erkannt;
    await app.getByRole("button", { name: "Browser" }).click();
    await expect(app.getByTestId("stt-modus-note")).toContainText(/verlässt das Gerät/);
    await app.getByTestId("nyx-fab").click();
    // Die App sagt offen, dass es jetzt ueber den Browser (Cloud) laeuft — und der
    // Hub bekommt waehrend des Diktats keine einzige Anfrage ab.
    await expect(app.getByTestId("nyx-fab-cloud")).toBeVisible();
    await app.waitForTimeout(1200);
    expect(anfragen).toEqual([]);
    expect(erkannt).toBe(vorher);
    await app.getByTestId("nyx-fab").click();
  });

  test("Lokal-Wahl erkennt am Hub und bleibt nach dem Neuladen gesetzt", async ({ app, hub, page }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Start" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await app.getByPlaceholder("Antworten…").click();
    await app.getByRole("button", { name: "Lokal" }).click();
    await expect(app.getByRole("button", { name: "Lokal" })).toHaveAttribute("aria-pressed", "true");
    await app.getByTestId("nyx-fab").click();
    await expect(app.getByTestId("nyx-fab")).toHaveClass(/recording/);
    await app.waitForTimeout(900);
    await app.getByTestId("nyx-fab").click();
    await expect(app.locator('[data-testid=nyx-fab-toast]').filter({ hasText: /lokal · / })).toBeVisible();
    await expect(app.getByPlaceholder("Antworten…")).toHaveValue(/Der Text kommt vom Hub/);
    expect(erkannt).toBeGreaterThan(0);

    await page.reload();
    await app.getByPlaceholder("Antworten…").click();
    await expect(app.getByRole("button", { name: "Lokal" })).toHaveAttribute("aria-pressed", "true");
  });

  test("Lokal-Wahl weicht nie in die Cloud aus, wenn der Hub nicht kann", async ({ app, hub, page }) => {
    // Der Hub meldet keine lokale Erkennung: "lokal" darf nicht heimlich umschalten.
    await page.route((adresse) => adresse.pathname.endsWith("/api/stt"), (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ available: false, local: true }) }),
    );
    const id = await hub.createSession({ adapter: "opencode", prompt: "Start" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    // Die App hat die Auskunft beim ersten Laden schon — ein echtes Neuladen holt
    // sie neu, damit die Attrappe des Hubs (verfuegbar: false) zum Zug kommt.
    await page.reload();
    await app.getByPlaceholder("Antworten…").click();
    await app.getByRole("button", { name: "Lokal" }).click();
    await expect(app.getByTestId("stt-modus-note")).toContainText(/nicht erreichbar/);
    // Der Knopf bleibt ehrlich blockiert und sagt, woran es liegt — kein stiller
    // Schwenk auf die Cloud, obwohl "lokal" gewaehlt ist.
    await expect(app.getByTestId("nyx-fab")).toHaveAttribute("aria-disabled", "true");
    await expect(app.getByTestId("nyx-fab")).toHaveAttribute("data-tip", /nicht erreichbar/);
    await expect(app.getByTestId("nyx-fab")).not.toHaveClass(/recording/);
  });
});
