import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { test, expect } from "../support/fixtures.ts";
import { freePort } from "../support/ports.ts";

/**
 * EPIC-P10.5 (ADR-0030): a video becomes session material. Stand-ins for
 * whisper-server (`/inference`, verbose_json) and the local model
 * (`/v1/chat/completions`); ffmpeg, ffprobe and tesseract are real.
 */
const video = fileURLToPath(new URL("../../packages/core/test/fixtures/media/slides.mp4", import.meta.url));
const port = await freePort();
let server: Server;
const seen: string[] = [];

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      seen.push(req.url ?? "");
      res.writeHead(200, { "content-type": "application/json" });
      if (req.url === "/inference") {
        res.end(
          JSON.stringify({
            detected_language: "de",
            segments: [
              { start: 0.2, end: 3, text: " Starte eine neue Session mit Codex." },
              { start: 6.2, end: 9.5, text: " Führe bitte die Tests mit npm test aus." },
              { start: 12.2, end: 15.4, text: " Der Worktree liegt unter data worktrees." },
            ],
          }),
        );
        return;
      }
      const content = JSON.stringify({
        summary: "Drei Folien: Session starten, Tests ausführen, Worktree prüfen.",
        keyPoints: ["Session mit Codex", "npm test", "Worktree"],
        chapters: [
          { start: "0:00", title: "Installation", summary: "Eine Session wird gestartet." },
          { start: "0:06", title: "Tests", summary: "npm test läuft." },
          { start: "0:12", title: "Worktree", summary: "Wo der Worktree liegt." },
        ],
      });
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
});
test.afterAll(() => server?.close());

test.use({ hubOptions: { sttUrl: `http://127.0.0.1:${port}/inference`, assistantUrl: `http://127.0.0.1:${port}/v1` } });

test.describe("Medien: Videos analysieren (EPIC-P10.5)", () => {
  // One stand-in server for both tests (one worker).
  test.describe.configure({ mode: "serial" });

  test("Videodatei → Schritte mit Fortschritt → Transkript, Schlüsselbilder mit Text, Kapitel; das Ergebnis geht in eine Session (AC-P10.5-1/5)", async ({ app, hub }) => {
    // ffmpeg on a shared CI runner needs longer than the 45 s default.
    test.setTimeout(120_000);
    const id = await hub.createSession({ adapter: "opencode", prompt: "Start" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.type === "assistant"), "first answer");
    await app.getByRole("button", { name: "Medien" }).click();
    await expect(app).toHaveURL(/#\/medien$/);
    await expect(app.locator(".media-caps")).toContainText("✓ Transkript lokal");
    await expect(app.locator(".media-caps")).toContainText("✓ Zusammenfassung lokal");
    await app.getByLabel("Videodatei").setInputFiles(video);
    const job = app.locator(".media-job.selected");
    await expect(job.locator(".chip")).toHaveText("fertig", { timeout: 60_000 });
    await expect(job.locator(".media-step.done")).toHaveCount(7);
    // Only own hardware was asked (stand-ins on 127.0.0.1): nothing to a third party.
    await expect(job.locator(".media-egress")).not.toContainText("googleapis");
    const result = job.locator(".media-result");
    await expect(result).toContainText("Drei Folien: Session starten");
    await expect(result.locator(".media-chapters li")).toHaveCount(3);
    await expect(result.locator(".media-frame")).toHaveCount(3);
    await expect(result.locator(".media-frame img")).toHaveCount(3);
    await expect(result.locator(".media-frame").nth(1)).toContainText(/Text im Bild: Kapitel 2/);
    await expect(result.locator(".media-line")).toHaveCount(3);
    // A file has no player: a chapter's timestamp marks the transcript line.
    await result.locator(".media-chapters li").nth(1).getByRole("button", { name: "0:06" }).click();
    await expect(result.locator(".media-line.focus")).toContainText("npm test");

    await result.getByLabel("Ziel-Session").selectOption(id);
    await result.getByRole("button", { name: "In Session verwenden" }).click();
    await expect(app).toHaveURL(new RegExp(`#/sessions/${id}$`));
    await app.getByRole("button", { name: "Chat" }).click();
    const chip = app.locator(".composer .attachment-chip");
    await expect(chip).toContainText("slides.video.md");
    await app.getByPlaceholder("Antworten…").fill("Wann geht es um die Tests?");
    await app.getByRole("button", { name: "Senden" }).click();
    // The harness got the result as text: title first, with timestamps inside.
    await expect(app.locator(".tail-scroll").getByText(/Texte: text: # Video: slides\.mp4/)).toBeVisible();
    expect(seen.filter((u) => u === "/inference")).toHaveLength(1);
  });

  test("YouTube-Link mit Untertiteln: kein STT nötig, Zeitmarke öffnet das Video an der Stelle; privates Video scheitert in Worten", async ({ app, context }) => {
    await app.getByRole("button", { name: "Medien" }).click();
    const before = seen.length;
    await app.getByLabel("Video-Link").fill("https://www.youtube.com/watch?v=untertitel");
    await app.getByRole("button", { name: "Analysieren" }).click();
    const job = app.locator(".media-job.selected");
    await expect(job.locator(".chip")).toHaveText("fertig", { timeout: 60_000 });
    await expect(job.locator(".media-job-head")).toContainText("E2E Folien-Video");
    await expect(job.locator(".media-step").nth(2)).toContainText("automatische Untertitel");
    await expect(job.locator(".media-egress")).toContainText("www.youtube.com (Quelle holen)");
    expect(seen.slice(before)).not.toContain("/inference");
    // No real YouTube in a test: the new tab gets a stand-in page.
    await context.route("https://www.youtube.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>YouTube</title>" }));
    const popup = context.waitForEvent("page");
    await job.locator(".media-chapters li").nth(1).getByRole("button", { name: "0:06" }).click();
    expect((await popup).url()).toBe("https://www.youtube.com/watch?v=untertitel&t=6s");

    await app.getByLabel("Video-Link").fill("https://www.youtube.com/watch?v=privat");
    await app.getByRole("button", { name: "Analysieren" }).click();
    await expect(app.locator(".media-job.selected .chip")).toHaveText("fehlgeschlagen", { timeout: 30_000 });
    await expect(app.locator(".media-job.selected .reply-error")).toContainText("Private video");
    await app.getByLabel("Video-Link").fill("http://192.168.1.20/intern.mp4");
    await app.getByRole("button", { name: "Analysieren" }).click();
    await expect(app.locator(".media-form .reply-error")).toContainText("Lokale Adressen werden nicht geholt.");
  });
});
