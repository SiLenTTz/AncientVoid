import { test, expect } from "../support/fixtures.ts";
import type { Page } from "@playwright/test";
import type { TestHub } from "../support/hub.ts";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * EPIC-P36 T36.5: Review-Notizen im Diff — Notieren → Hub-Restart →
 * Sammelversand → Revision → veralteter Anker; außerdem Offline-Entwurf
 * ohne Scheinversand (AC-P36-1 … AC-P36-5).
 */

async function workdirOf(hub: TestHub, id: string): Promise<string> {
  await hub.until(async () => (await hub.events(id)).some((e) => e.payload.kind === "session.created"), "session.created");
  const workdir = String((await hub.events(id)).find((e) => e.payload.kind === "session.created")?.payload.workdir);
  expect(workdir).toBeTruthy();
  return workdir;
}

async function idle(hub: TestHub, id: string): Promise<void> {
  await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "turn over");
}

async function openDiff(app: Page, hub: TestHub, id: string): Promise<void> {
  await app.goto(`${hub.origin}/#/sessions/${id}`);
  await app.getByRole("button", { name: "Diff" }).click();
}

test.describe("Review-Feedback am Diff (EPIC-P36)", () => {
  test("Notieren → Hub-Restart → Senden → Revision → veralteter Anker", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy" });
    await idle(hub, id);
    const workdir = await workdirOf(hub, id);
    await writeFile(join(workdir, "review-target.txt"), "alpha\nbeta\ngamma\n");

    // Notieren: Anker an der Zeile „beta“ setzen
    await openDiff(app, hub, id);
    await expect(app.locator(".diff-file-row").filter({ hasText: "review-target.txt" })).toBeVisible();
    await app.getByRole("button", { name: "Notiz an Zeilen" }).click();
    await app.locator(".review-pickable").filter({ hasText: "beta" }).first().click();
    await app.getByPlaceholder("Befund notieren …").fill("Bitte beta erklären");
    await app.getByRole("button", { name: "speichern" }).click();
    const note = app.locator(".review-note").filter({ hasText: "Bitte beta erklären" });
    await expect(note).toBeVisible();
    await expect(note.locator(".review-status")).toHaveText("Entwurf");

    // Hub-Crash (SIGKILL) — Notiz und Status kommen aus Journal+Snapshot zurück (AC-P36-1)
    await hub.restart("SIGKILL");
    await openDiff(app, hub, id);
    const noteAfter = app.locator(".review-note").filter({ hasText: "Bitte beta erklären" });
    await expect(noteAfter).toBeVisible();
    await expect(noteAfter.locator(".review-status")).toHaveText("Entwurf");

    // Sammelversand mit Vorschau (AC-P36-2)
    await noteAfter.locator("input[type=checkbox]").check();
    await app.getByRole("button", { name: /sammeln und senden/ }).click();
    await expect(app.locator(".review-prompt-preview")).toContainText("Sammel-Review");
    await app.locator(".review-send-dialog").getByRole("button", { name: /senden/ }).click();
    await expect(noteAfter.locator(".review-status")).toHaveText("gesendet", { timeout: 15_000 });

    // Revision: Inhalt am Anker ändern → veraltet, nicht versendbar (AC-P36-3).
    // Der Hub cached Diff/HEAD 5 s für die Ankerprüfung — deshalb pollend neu
    // laden, bis die Neubewertung durch ist (kein blindes Warten).
    await writeFile(join(workdir, "review-target.txt"), "alpha\nbeta geändert\ngamma\n");
    const stale = app.locator(".review-note").filter({ hasText: "Bitte beta erklären" });
    for (let attempt = 0; attempt < 6; attempt += 1) {
      // goto mit neuem Hash ist KEIN Reload — die Ansicht muss wirklich neu
      // mounten, damit Diff (und damit die Ankerbewertung) neu geholt wird.
      await app.reload();
      await app.getByRole("button", { name: "Diff" }).click();
      if (await stale.locator(".review-stale-badge").count()) break;
      await new Promise((r) => setTimeout(r, 1500));
    }
    await expect(stale.locator(".review-stale-badge")).toContainText("veraltet");
    await expect(stale.locator("input[type=checkbox]")).toBeDisabled();
    // API-Seite: veraltete Anker werden nicht versendet
    const notesRes = (await hub.api<{ items: Array<{ id: string }> }>(`/api/sessions/${id}/reviews`)).body;
    const send = await hub.api(`/api/sessions/${id}/reviews/send`, {
      method: "POST",
      body: { noteIds: [notesRes.items![0]!.id], operationId: "e2e-review-stale-0001" },
    });
    expect(send.status).toBe(422);
  });

  test("Offline: Notiz bleibt lokal mit Zeitstempel, kein Scheinversand", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy" });
    await idle(hub, id);
    const workdir = await workdirOf(hub, id);
    await writeFile(join(workdir, "offline-target.txt"), "eins\nzwei\n");

    await openDiff(app, hub, id);
    // Diff muss vollständig geladen sein, BEVOR offline geschaltet wird —
    // sonst scheitert der Fetch offline und es gibt keine anklickbaren Zeilen.
    await expect(app.locator(".diff-file-row").filter({ hasText: "offline-target.txt" })).toBeVisible();
    await app.context().setOffline(true);
    await app.getByRole("button", { name: "Notiz an Zeilen" }).click();
    await app.locator(".review-pickable").filter({ hasText: "zwei" }).first().click();
    await app.getByPlaceholder("Befund notieren …").fill("Offline-Befund");
    await app.getByRole("button", { name: "speichern" }).click();

    // Lokal geparkt, sichtbar mit Zeitstempel — kein „gesendet“ (AC-P36-5)
    await expect(app.locator(".review-note.outboxed")).toContainText("noch nicht gesendet");
    await expect(app.getByText(/Offline — Änderungen werden lokal gehalten/)).toBeVisible();

    // Wieder online: Outbox wird nachgezogen, die Notiz erscheint als Entwurf
    await app.context().setOffline(false);
    const synced = app.locator(".review-note").filter({ hasText: "Offline-Befund" }).first();
    await expect(synced.locator(".review-status")).toHaveText("Entwurf", { timeout: 15_000 });
  });
});
