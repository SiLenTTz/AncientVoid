import { createServer, type Server } from "node:http";
import { WebSocketServer } from "ws";
import { test, expect } from "../support/fixtures.ts";
import { freePort } from "../support/ports.ts";

/**
 * T10.2 (ADR-0028): push to talk with local recognition. A stand-in for
 * whisper-server that only accepts what the real one needs — 16 kHz mono
 * 16-bit WAV — so the test proves the hub converted the phone's recording.
 */
const port = await freePort();
const streamPort = await freePort();
let server: Server;
let streamServer: WebSocketServer;
const received: { rate: number; channels: number; bytes: number; prompt: boolean; language: string }[] = [];

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const riff = body.indexOf("RIFF");
      const wav = riff >= 0 ? body.subarray(riff) : Buffer.alloc(0);
      const text = body.toString("latin1");
      const info = { rate: wav.length > 28 ? wav.readUInt32LE(24) : 0, channels: wav.length > 24 ? wav.readUInt16LE(22) : 0, bytes: wav.length, prompt: text.includes('name="prompt"') && text.includes("Worktree"), language: /name="language"\r\n\r\n(\w+)/.exec(text)?.[1] ?? "" };
      received.push(info);
      const ok = info.rate === 16_000 && info.channels === 1 && info.bytes > 3000;
      res.writeHead(ok ? 200 : 400, { "content-type": "application/json" });
      res.end(JSON.stringify(ok ? { text: "Starte die Tests im Worktree" } : { error: "not 16k mono wav" }));
    });
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  streamServer = new WebSocketServer({ host: "127.0.0.1", port: streamPort });
  await new Promise<void>((resolve) => streamServer.once("listening", resolve));
  streamServer.on("connection", (socket) => {
    let sentPartial = false;
    socket.on("message", (raw, isBinary) => {
      if (isBinary) {
        if (!sentPartial) {
          sentPartial = true;
          socket.send(JSON.stringify({ type: "conversation.item.input_audio_transcription.delta", delta: "Nicht stoppen" }));
        }
        return;
      }
      const event = JSON.parse(raw.toString()) as { type?: string };
      if (event.type === "session.update") socket.send(JSON.stringify({ type: "session.updated" }));
      if (event.type === "input_audio_buffer.commit") socket.send(JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", transcript: "Bitte weiter" }));
    });
  });
});
test.afterAll(async () => {
  server?.close();
  if (streamServer) await new Promise<void>((resolve) => streamServer.close(() => resolve()));
});

test.use({
  hubOptions: { sttUrl: `http://127.0.0.1:${port}/inference` },
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
});

test.describe("Lokale Spracherkennung (T10.2)", () => {

  test.describe("Live-Streaming", () => {
    test.use({ hubOptions: { sttUrl: `http://127.0.0.1:${port}/inference`, sttStreamingUrl: `ws://127.0.0.1:${streamPort}/v1/audio/transcriptions/realtime` } });

  test("Live-Teiltranskript bleibt Vorschau; nur der finale Text landet editierbar im Feld", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Start" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    const voice = app.locator(".composer-actions").getByRole("button", { name: "Voice" });
    await expect(voice).toHaveAttribute("title", /Spracheingabe lokal/);
    await voice.click();
    await expect(app.getByText(/Aufnahme — tippe „Stopp“/)).toBeVisible();
    const partial = app.getByRole("status").filter({ hasText: "Vorschau (wird nicht ausgeführt): Nicht stoppen" });
    await expect(partial).toBeVisible({ timeout: 10_000 });
    expect((await hub.events(id)).filter((e) => e.type === "user")).toHaveLength(1);
    await app.locator(".composer-actions").getByRole("button", { name: "Stopp" }).click();
    await expect(app.getByPlaceholder("Antworten…")).toHaveValue("Bitte weiter");
    expect((await hub.events(id)).filter((e) => e.type === "user")).toHaveLength(1);
  });
  });

  test("Voice nimmt auf, der Hub erkennt lokal, der Text landet editierbar im Feld — mit K6-Zeit", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Start" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    const voice = app.locator(".composer-actions").getByRole("button", { name: "Voice" });
    await expect(voice).toHaveAttribute("title", /lokal \(whisper-e2e\)/);
    await voice.click();
    await expect(app.getByText(/Aufnahme — tippe „Stopp“/)).toBeVisible();
    await app.waitForTimeout(1200);
    await app.locator(".composer-actions").getByRole("button", { name: "Stopp" }).click();
    await expect(app.getByPlaceholder("Antworten…")).toHaveValue("Starte die Tests im Worktree");
    await expect(app.locator(".composer-notice").filter({ hasText: /lokal · whisper-e2e · \d+\.\d s/ })).toBeVisible();
    expect(received.at(-1)).toMatchObject({ rate: 16_000, channels: 1, prompt: true, language: "de" });
    // Nothing was sent to the session — the text only sits in the field.
    expect((await hub.events(id)).filter((e) => e.type === "user")).toHaveLength(1);
  });

  test("Gesperrter Bildschirm bricht die Aufnahme sichtbar ab — nichts wird erkannt oder gesendet (AC-P10-5)", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Start" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    const before = received.length;
    await app.locator(".composer-actions").getByRole("button", { name: "Voice" }).click();
    await expect(app.getByText(/Aufnahme — tippe „Stopp“/)).toBeVisible();
    await app.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(app.getByText(/Aufnahme abgebrochen — Bildschirm gesperrt/)).toBeVisible();
    await expect(app.locator(".composer-actions").getByRole("button", { name: "Voice" })).toBeVisible();
    await expect(app.getByPlaceholder("Antworten…")).toHaveValue("");
    expect(received.length).toBe(before);
  });

  test("Schon gesperrter Bildschirm beim Aufnahmestart bricht ebenfalls ab (BUG-0041)", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "opencode", prompt: "Start" });
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    const before = received.length;
    // Gesperrt, bevor die Aufnahme beginnt (z. B. während des Mikrofon-Dialogs):
    // es kommt kein weiteres visibilitychange-Event mehr.
    await app.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    });
    await app.locator(".composer-actions").getByRole("button", { name: "Voice" }).click();
    await expect(app.getByText(/Aufnahme abgebrochen — Bildschirm gesperrt/)).toBeVisible();
    await expect(app.locator(".composer-actions").getByRole("button", { name: "Voice" })).toBeVisible();
    expect(received.length).toBe(before);
  });
});
