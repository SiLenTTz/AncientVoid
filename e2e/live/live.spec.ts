import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";

const url = process.env.ANCIENTVOID_LIVE_URL ?? "http://127.0.0.1:7373";
const token = process.env.ANCIENTVOID_LIVE_TOKEN ?? "";

async function open(page: Page, hash = ""): Promise<void> {
  await page.addInitScript((t) => localStorage.setItem("ancientvoid.token", t), token);
  await page.goto(`${url}/${hash}`);
}

async function api<T>(path: string): Promise<T> {
  const res = await fetch(`${url}${path}`, { headers: { authorization: `Bearer ${token}` } });
  expect(res.status, path).toBe(200);
  return (await res.json()) as T;
}

test.describe("Live-Hub (nur lesend)", () => {
  test.skip(!token, "ANCIENTVOID_LIVE_TOKEN fehlt");

  test("Übersicht, Flotte und Status laden", async ({ page }) => {
    const hosts = await api<{ hostId: string; reachable?: boolean; state?: string }[] | { hosts: { hostId: string }[] }>("/api/fleet");
    await open(page);
    await expect(page.locator(".dashboard")).toBeVisible();
    // T8.1: sections instead of a cost line (costs only when reported).
    await expect(page.locator(".session-section, .dashboard .empty").first()).toBeVisible();
    // BUG-0084: „Status“ matchte zusätzlich den Session-Knopf „Gate-Status
    // prüfen und Stand“ — exact deckt nur den Header-Link (Text „Status“,
    // title „Provider-Status“ wird vom Text-Inhalt überstimmt).
    await page.getByRole("button", { name: "Status", exact: true }).click();
    await expect(page.locator(".inventory-table")).toBeVisible();
    expect(JSON.stringify(hosts)).toContain("hostId");
  });

  test("eine vorhandene Session: Bericht ehrlich, Code-Suche lokal", async ({ page }) => {
    const sessions = await api<{ id: string; hostId: string; project: string }[]>("/api/sessions");
    const local = sessions.filter((s) => s.hostId === "local" || !s.hostId.includes("-"));
    test.skip(local.length === 0, "keine Session auf diesem Hub");
    const s = local[0]!;
    await open(page, `#/sessions/${s.id}`);
    await page.getByRole("button", { name: "Bericht" }).click();
    await expect(page.locator(".kv-row").filter({ hasText: "Kosten" }).locator(".v")).not.toHaveText("$0");
    await page.getByRole("button", { name: "Code", exact: true }).click();
    await page.getByLabel("Code durchsuchen").fill("function");
    await page.getByRole("button", { name: "Text" }).click();
    await page.getByRole("button", { name: "Suchen" }).click();
    await expect(page.locator(".code-engine, .reply-error, .empty").first()).toBeVisible();
    await expect(page.locator(".code-actions")).toContainText("Git-Status");
  });

  test("Einstellungen zeigen den Gemini-Schlüssel nie", async ({ page }) => {
    const settings = await api<Record<string, unknown>>("/api/settings");
    expect(JSON.stringify(settings)).not.toMatch(/AIza[0-9A-Za-z_-]{20,}/);
    await open(page);
    // BUG-0084: das Benachrichtigungs-⚙ trägt dasselbe aria-label
    // „Einstellungen“ (Notifications.tsx) wie der Dock-Knopf — deshalb
    // scoped auf die globale Navigation (.dock), nicht auf die ganze Seite.
    const settingsButton = page.locator(".dock").getByRole("button", { name: "Einstellungen", exact: true });
    // EPIC-P43 T43.3: am Handy liegt „Einstellungen“ unter „Mehr“.
    if (!(await settingsButton.isVisible())) await page.locator(".dock").getByRole("button", { name: "Mehr", exact: true }).click();
    await settingsButton.click();
    await expect(page.getByText(/Gemini/).first()).toBeVisible();
  });

  test("Aufträge in Worten: „Zeig wartende Sessions“ plant und filtert (nur lesend)", async ({ page }) => {
    await open(page);
    await expect(page.locator(".dashboard")).toBeVisible();
    await page.getByLabel("Auftrag in Worten (Strg+K)").click();
    await page.getByLabel("Auftrag", { exact: true }).fill("Zeig wartende Sessions");
    await page.getByRole("button", { name: "Planen" }).click();
    await expect(page.getByRole("button", { name: "nur wartende ✕" })).toBeVisible();
  });

  test("Lokale Spracherkennung: Diktat (WebM wie vom Handy) → Hub → whisper.cpp → Text (P10)", async () => {
    const stt = await api<{ available: boolean; engine?: string }>("/api/stt");
    test.skip(!stt.available, "stt nicht konfiguriert");
    // Piper „Thorsten“: „Führe bitte die Tests mit npm test aus und zeig mir die Fehler.“
    const audio = readFileSync(new URL("./fixtures/diktat-npm-test.webm", import.meta.url));
    const res = await fetch(`${url}/api/stt`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "audio/webm" }, body: audio });
    expect(res.status).toBe(200);
    const out = (await res.json()) as { text: string; latencyMs: number };
    expect(out.text.toLowerCase()).toMatch(/tests/);
    expect(out.text.toLowerCase().replace(/[^\p{L}]/gu, "")).toContain("npmtest"); // Schreibweise egal (npm-test, npm test)
    expect(out.latencyMs).toBeLessThan(1500); // K6
  });

  test("Videoanalyse: Datei → whisper.cpp + Szenenbilder + OCR → Ergebnis; Job wird danach gelöscht (P10.5)", async () => {
    const info = await api<{ available: boolean; stt: boolean; summary: boolean }>("/api/media");
    test.skip(!info.available, "ffmpeg fehlt");
    const video = readFileSync(new URL("../../packages/core/test/fixtures/media/slides.mp4", import.meta.url));
    const up = await fetch(`${url}/api/media/upload?language=de`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "video/mp4", "x-filename": "live-smoke.mp4" }, body: video });
    expect(up.status).toBe(201);
    const job = (await up.json()) as { id: string };
    try {
      let status = "";
      for (let i = 0; i < 120 && !["done", "failed", "cancelled"].includes(status); i++) {
        await new Promise((r) => setTimeout(r, 1000));
        status = (await api<{ status: string }>(`/api/media/jobs/${job.id}`)).status;
      }
      expect(status).toBe("done");
      const r = await api<{ transcript: { text: string }[]; frames: { ocr: string | null }[]; chapters: unknown[]; summaryVia: string | null }>(`/api/media/jobs/${job.id}/result`);
      expect(r.frames).toHaveLength(3);
      expect(r.frames.some((f) => /Kapitel/.test(f.ocr ?? ""))).toBe(true);
      if (info.stt) expect(r.transcript.map((s) => s.text).join(" ")).toMatch(/Tests|Worktree|Session/i);
      expect(r.chapters.length).toBeGreaterThan(0);
    } finally {
      await fetch(`${url}/api/media/jobs/${job.id}`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
    }
  });
});

