import { createServer, type Server } from "node:http";
import { test, expect } from "../support/fixtures.ts";

/**
 * T10.2 (ADR-0028): push to talk with local recognition. A stand-in for
 * whisper-server that only accepts what the real one needs — 16 kHz mono
 * 16-bit WAV — so the test proves the hub converted the phone's recording.
 */
const port = 19_000 + Math.floor(Math.random() * 900);
let server: Server;
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
});
test.afterAll(() => server?.close());

test.use({
  hubOptions: { sttUrl: `http://127.0.0.1:${port}/inference` },
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
});

test.describe("Lokale Spracherkennung (T10.2)", () => {

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
});
