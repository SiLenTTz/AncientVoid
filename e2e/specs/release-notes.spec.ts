import { test, expect } from "../support/fixtures.ts";
import type { Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { appendFileSync } from "node:fs";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

/** EPIC-P68 (ADR-0089): Release-Notes-Seite — gemergte PRs aus echten Merges im
 * Fixture-Projekt: Kurzfassung aus der Commit-Notation, aufklappbar Was
 * (Commits) und Warum (PR-Beschreibung); rohe Subjects ohne Notation bleiben. */

async function git(project: string, ...args: string[]): Promise<void> {
  await execFileAsync("git", ["-C", project, ...args]);
}

async function mergePr(project: string, branch: string, subject: string, body: string): Promise<void> {
  await git(project, "checkout", "-q", "main");
  await git(project, "merge", "--no-ff", "-q", "-m", subject, "-m", body, branch);
}

async function openReleaseNotes(app: Page): Promise<void> {
  await app.getByRole("button", { name: /Mehr/ }).first().click();
  await app.getByRole("dialog", { name: "Mehr" }).getByRole("button", { name: "Release-Notes" }).click();
  await expect(app).toHaveURL(/#\/releasenotes$/);
}

test.describe("Release-Notes (EPIC-P68, ADR-0089)", () => {
  test("listet gemergte PRs mit Kurzfassung; Aufklappen zeigt Was und Warum", async ({ app, hub }) => {
    const a = hub.alpha;
    await git(a, "config", "user.email", "e2e@ancientvoid.local");
    await git(a, "config", "user.name", "e2e");
    await git(a, "checkout", "-q", "-b", "feat/eins");
    appendFileSync(join(a, "a.ts"), "export const a = 1;\n");
    await git(a, "add", ".");
    await git(a, "commit", "-q", "-m", "^ F core: erste Faehigkeit", "-m", "Warum: der Handy-Abfluss braucht sie.");
    await mergePr(a, "feat/eins", "^ F core: erste Faehigkeit (#1)", "PR-Beschreibung: bündelt T1 mit einem Commit.");

    await openReleaseNotes(app);
    await expect(app.getByTestId("release-notes-page")).toBeVisible();
    await app.getByTestId("rn-project").selectOption({ label: "alpha" });

    const entry = app.getByTestId("rn-entry").first();
    await expect(entry).toBeVisible({ timeout: 15_000 });
    await expect(entry).toContainText("#1");
    await expect(entry).toContainText("erste Faehigkeit");
    await expect(entry).toContainText("geprüft · Feature · core");

    // Aufklappen: Warum (PR-Beschreibung) und Was (Commit mit eigener Body).
    await entry.locator(".rn-toggle").click();
    const detail = app.getByTestId("rn-detail");
    await expect(detail).toBeVisible();
    await expect(detail).toContainText("bündelt T1");
    await expect(detail).toContainText("Handy-Abfluss");
    await expect(detail.getByTestId("rn-commit")).toHaveCount(1);
  });

  test("PR ohne Notation bleibt roh sichtbar statt zu verschwinden (fail loud)", async ({ app, hub }) => {
    const a = hub.alpha;
    await git(a, "config", "user.email", "e2e@ancientvoid.local");
    await git(a, "config", "user.name", "e2e");
    await git(a, "checkout", "-q", "-b", "feat/zwei");
    appendFileSync(join(a, "c.ts"), "fix();\n");
    await git(a, "add", ".");
    await git(a, "commit", "-q", "-m", "! B pwa: fehler repariert", "-m", "BUG-0001: Anzeige blieb stehen.");
    await mergePr(a, "feat/zwei", "BUG-0001: Chat laedt wieder (#2)", "Warum: Regression.");

    await openReleaseNotes(app);
    await app.getByTestId("rn-project").selectOption({ label: "alpha" });
    const entry = app.getByTestId("rn-entry").first();
    await expect(entry).toBeVisible({ timeout: 15_000 });
    await expect(entry).toContainText("BUG-0001: Chat laedt wieder (#2)");
    await expect(entry.locator(".rn-unparsed")).toBeVisible();
  });

  test("Projekt ohne gemergte PRs benennt den Leerzustand (kein White-Screen)", async ({ app }) => {
    await openReleaseNotes(app);
    await app.getByTestId("rn-project").selectOption({ label: "beta" });
    await expect(app.getByRole("status")).toContainText("Keine gemergten Pull-Requests im Verlauf.", { timeout: 15_000 });
  });
});
