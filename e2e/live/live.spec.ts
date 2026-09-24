import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";

const url = process.env.UACC_LIVE_URL ?? "http://127.0.0.1:7373";
const token = process.env.UACC_LIVE_TOKEN ?? "";

async function open(page: Page, hash = ""): Promise<void> {
  await page.addInitScript((t) => localStorage.setItem("uacc.token", t), token);
  await page.goto(`${url}/${hash}`);
}

async function api<T>(path: string): Promise<T> {
  const res = await fetch(`${url}${path}`, { headers: { authorization: `Bearer ${token}` } });
  expect(res.status, path).toBe(200);
  return (await res.json()) as T;
}

test.describe("Live-Hub (nur lesend)", () => {
  test.skip(!token, "UACC_LIVE_TOKEN fehlt");

  test("Übersicht, Flotte und Status laden", async ({ page }) => {
    const hosts = await api<{ hostId: string; reachable?: boolean; state?: string }[] | { hosts: { hostId: string }[] }>("/api/fleet");
    await open(page);
    await expect(page.locator(".dashboard")).toBeVisible();
    // T8.1: sections instead of a cost line (costs only when reported).
    await expect(page.locator(".session-section, .dashboard .empty").first()).toBeVisible();
    await page.getByRole("button", { name: "Status" }).click();
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
    await page.getByRole("button", { name: "Einstellungen" }).click();
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
});

