import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, sessionTab } from "../support/fixtures.ts";

/**
 * EPIC-P38 T38.5 (ADR-0057): Arbeitsort „eigener Worktree“ / „Projekt direkt“.
 * Das Zielrepo (alpha) trägt einen Sentinel; er bleibt über Stop, Archiv und
 * Löschen unverändert erhalten (AC-P38-5). Die echte Scratch-Repo-Abnahme
 * außerhalb des Gates steht in
 * docs/workplace-runbook.md.
 */
const README = "README.md";

test.describe("Session-Arbeitsort (EPIC-P38)", () => {
  test("Standard: zwei Sessions laufen parallel in getrennten Worktrees, Projekt bleibt unberührt", async ({ hub }) => {
    const before = readFileSync(join(hub.alpha, README), "utf8");
    const a = await hub.createSession({ adapter: "dummy" });
    const b = await hub.createSession({ adapter: "dummy" });
    const dirs = await Promise.all([a, b].map(async (id) => (await hub.api<{ path: string; mode: string }>(`/api/sessions/${id}/workplace`)).body));
    expect(dirs.map((d) => d.mode)).toEqual(["worktree", "worktree"]);
    expect(dirs[0]!.path).not.toBe(dirs[1]!.path);
    for (const d of dirs) expect(d.path).not.toBe(hub.alpha);
    expect(readFileSync(join(hub.alpha, README), "utf8")).toBe(before);
  });

  test("Neue Session: Karten, getrennte Sandbox-Erklärung; Projekt direkt wird im Kopf angezeigt und blockiert den zweiten Schreiber", async ({ app, hub }) => {
    await app.getByRole("button", { name: "Neue Session" }).click();
    await app.getByLabel("Adapter").selectOption("dummy");
    const choice = app.locator(".workplace-choice");
    await expect(choice.getByRole("radio", { name: "Arbeitsort Worktree" })).toBeChecked();
    await expect(choice).toContainText("keine Prozess- oder Netzwerkrechte");
    await choice.getByRole("radio", { name: "Arbeitsort direkt im Ordner" }).check();
    await expect(app.getByTestId("workplace-detail")).toContainText("alpha");
    await app.getByRole("button", { name: "Starten" }).click();
    await expect(app.locator(".session-top-meta .workplace-badge")).toHaveAttribute("data-mode", "direct");
    const [first] = await hub.sessions();
    const id = first!.id;
    expect((await hub.api<{ path: string }>(`/api/sessions/${id}/workplace`)).body.path).toBe(hub.alpha);

    // Zweiter direkter Start: vor Spawn verweigert (API) und in der Karte sichtbar
    const refused = await hub.api<{ error?: string }>("/api/sessions", { body: { adapter: "dummy", project: hub.alpha, workspaceMode: "direct" } });
    expect(refused.status).toBe(422);
    expect(refused.body.error).toMatch(/schreibt bereits/);
    await app.getByLabel("Zur Übersicht").click();
    await app.getByRole("button", { name: "Neue Session" }).click();
    await app.getByLabel("Adapter").selectOption("dummy");
    await app.locator(".workplace-choice").getByRole("radio", { name: "Arbeitsort direkt im Ordner" }).check();
    await expect(app.locator(".workplace-detail [role=alert]")).toContainText("schreibt bereits");
    await expect(app.getByRole("button", { name: "Starten" })).toBeDisabled();
    await app.locator(".workplace-choice").getByRole("radio", { name: "Arbeitsort Worktree" }).check();
    await expect(app.getByRole("button", { name: "Starten" })).toBeEnabled();
  });

  test("Dirty-Start: Bestätigung nötig, Baseline markiert die bestehende Änderung, Stop/Archiv/Löschen lassen das Projekt unberührt", async ({ app, hub }) => {
    writeFileSync(join(hub.alpha, README), "# Alpha\n\nFremde, ungesicherte Änderung.\n");
    const dirtyContent = readFileSync(join(hub.alpha, README), "utf8");
    const refused = await hub.api<{ error?: string }>("/api/sessions", { body: { adapter: "dummy", project: hub.alpha, workspaceMode: "direct" } });
    expect(refused.status).toBe(422);
    expect(refused.body.error).toMatch(/ungesicherte Änderungen/);

    const id = await hub.createSession({ adapter: "dummy", workspaceMode: "direct", confirmDirty: true });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "turn over");
    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await sessionTab(app, "Diff");
    await expect(app.locator(".diff-pane .workplace-warn")).toContainText("schon geändert");
    await expect(app.locator(".diff-preexisting").first()).toBeVisible();

    await hub.api(`/api/sessions/${id}/steer`, { body: { kind: "stop" } });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "stopped", "stopped");
    await hub.api(`/api/sessions/${id}/archive`, { body: { archived: true } });
    expect(existsSync(join(hub.alpha, ".git"))).toBe(true);
    expect(readFileSync(join(hub.alpha, README), "utf8")).toBe(dirtyContent);
    // Nach dem Stop ist der Checkout wieder frei
    const again = await hub.api<{ id?: string }>("/api/sessions", { body: { adapter: "dummy", project: hub.alpha, workspaceMode: "direct", confirmDirty: true } });
    expect(again.status).toBe(201);
  });

  test("K7: Arbeitsort und Lease überleben einen Hub-SIGKILL — der Checkout bleibt belegt, Resume erhält den Ort", async ({ hub }) => {
    const id = await hub.createSession({ adapter: "dummy", workspaceMode: "direct" });
    await hub.until(async () => (await hub.api<{ status: string }>(`/api/sessions/${id}`)).body.status === "idle", "turn over");
    await hub.restart("SIGKILL");
    const status = await hub.api<{ mode: string; path: string; leaseGeneration: number | null }>(`/api/sessions/${id}/workplace`);
    expect(status.body).toMatchObject({ mode: "direct", path: hub.alpha });
    const second = await hub.api<{ error?: string }>("/api/sessions", { body: { adapter: "dummy", project: hub.alpha, workspaceMode: "direct" } });
    expect(second.status).toBe(422);
    expect(second.body.error).toMatch(/schreibt bereits/);
    expect(existsSync(join(hub.alpha, README))).toBe(true);
  });
});
