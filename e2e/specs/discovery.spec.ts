import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Page } from "@playwright/test";
import { test, expect } from "../support/fixtures.ts";
import type { TestHub } from "../support/hub.ts";

/** Claude Code names a project dir after its cwd. Discovery only shows projects
 * under a configured root (7c5f168), so the name starts with the munged root. */
function externalClaude(hub: TestHub, project: string, ids: string[], content?: (id: string) => string): string {
  const dir = join(hub.root, "claude", "projects", hub.projectsDir.replace(/[^a-zA-Z0-9]/g, "-") + project);
  mkdirSync(dir, { recursive: true });
  for (const id of ids) writeFileSync(join(dir, `${id}.jsonl`), content?.(id) ?? `{"type":"user","sessionId":"${id}"}\n`);
  return dir;
}

/** Collapsible groups (BUG-0035 follow-up): only the newest project starts
 * expanded — tests flip every folded group open before asserting rows.
 * One at a time: the closed-set shrinks with every click. */
async function expandAllGroups(app: Page) {
  for (let i = 0; i < 20; i++) {
    const next = app.locator(".project-tile:not([open]) > summary").first();
    if ((await next.count()) === 0) break;
    await next.click();
  }
}

test.describe("Gefundene Sessions (T5.3, AC-P5-1)", () => {
  test("Hub- und externe Sessions erscheinen einmal, mit Herkunft und unbekanntem Format @desktop", async ({ app, hub }) => {
    const own = await hub.createSession({ adapter: "dummy" });
    await hub.createSession({ adapter: "dummy", project: hub.beta });
    const dir = externalClaude(hub, "-home-user-extern", ["ext-1", "ext-2"]);
    externalClaude(hub, "-home-user-kopie", ["ext-1"]);
    mkdirSync(join(dir, "ext-2", "subagents"), { recursive: true });
    writeFileSync(join(dir, "ext-2", "subagents", "agent-9.jsonl"), "{}\n");
    writeFileSync(join(dir, "notizen.txt"), "kein Transkript\n");

    await app.getByRole("button", { name: "Gefunden" }).click();
    await expect(app.getByText("6 gefunden")).toBeVisible();
    await expect(app.getByText("1 unbekanntes Format")).toBeVisible();
    // collapsible: exactly one group open by default, the rest folded
    // (kopie's ext-1 is deduped into extern — 3 groups, not 4)
    const tiles = app.locator(".project-tile");
    await expect(tiles).toHaveCount(3);
    await expect(tiles.and(app.locator("[open]"))).toHaveCount(1);
    await expandAllGroups(app);
    const rows = app.locator(".discovered-row");
    await expect(rows.filter({ hasText: "ext-1" })).toHaveCount(1);
    await expect(rows.filter({ hasText: "agent-9" }).getByText("Subagent von ext-2")).toBeVisible();
    await expect(rows.filter({ hasText: "extern · nur beobachtet" })).toHaveCount(4);
    await expect(rows.filter({ hasText: "Hub" }).filter({ hasNotText: "extern" })).toHaveCount(2);

    await rows.filter({ hasText: own }).locator(".session-open").click();
    await expect(app).toHaveURL(new RegExp(`#/sessions/${own}`));
    await expect(app.locator(".session-topbar")).toContainText("dummy");
  });

  test("AC-P5-1: 20 Sessions, je zwei pro Projekt, sind binnen 10 s vollständig sichtbar", async ({ app, hub }, info) => {
    for (const project of [hub.alpha, hub.beta]) for (let i = 0; i < 5; i++) await hub.createSession({ adapter: "dummy", project });
    for (let p = 1; p <= 5; p++) externalClaude(hub, `-home-user-extern-${p}`, [`ext-${p}-a`, `ext-${p}-b`]);
    const t0 = Date.now();
    await app.getByRole("button", { name: "Gefunden" }).click();
    await expect(app.getByText("20 gefunden")).toBeVisible({ timeout: 10_000 });
    await expandAllGroups(app);
    await expect(app.locator(".discovered-row")).toHaveCount(20);
    info.annotations.push({ type: "sichtbar nach ms", description: String(Date.now() - t0) });
    expect(Date.now() - t0).toBeLessThan(10_000);
    await expect(app.locator(".project-tile")).toHaveCount(7);
  });

  test("einen Subagent-Verlauf fortsetzen übernimmt die Haupt-Session samt Transkript (ADR-0011, Live-Fund 2026-09-28)", async ({ app, hub }) => {
    const parent = "11111111-1111-4111-8111-111111111111";
    // the external project dir must un-munge into an allowed project (alpha)
    const mungedAlpha = hub.alpha.replace(/[^a-zA-Z0-9]/g, "-");
    const dir = join(hub.root, "claude", "projects", mungedAlpha);
    mkdirSync(join(dir, parent, "subagents"), { recursive: true });
    writeFileSync(join(dir, `${parent}.jsonl`), `{"type":"user","sessionId":"${parent}"}\n`);
    writeFileSync(join(dir, parent, "subagents", "agent-9.jsonl"), "{}\n");

    await app.getByRole("button", { name: "Gefunden" }).click();
    await expandAllGroups(app);
    // der Subagent-Zeile: „Fortsetzen" übernimmt die Haupt-Session
    const row = app.locator(".discovered-row").filter({ hasText: "agent-9" });
    await row.getByRole("button", { name: "Fortsetzen" }).click();
    await expect(app.locator(".session-topbar")).toContainText("claude");
    const id = decodeURIComponent(app.url().split("#/sessions/")[1]!);
    const events = await hub.events(id);
    // die Historie der Haupt-Session ist im Tail — ohne den Agenten zu
    // fragen. Das Transkript ist nach der Parent-ID benannt: gefunden
    // heißt, die Haupt-Session (nicht der Subagent) wurde fortgesetzt.
    expect(events.some((e) => (e.payload as { kind?: string }).kind === "claude.transcript_imported")).toBe(true);
  });

  test("eine beobachtete opencode-Session spiegeln: derselbe Text erscheint im Hub-Chat (ADR-0011 Erweiterung)", async ({ app, hub }) => {
    // der TestHub-Store ist leer und isoliert — die gespiegelte Session
    // lebte „außerhalb": Historie nur in opencodes eigenem Store
    const odb = new DatabaseSync(join(hub.root, "opencode.db"));
    odb.exec("CREATE TABLE IF NOT EXISTS message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT)");
    odb.exec("CREATE TABLE IF NOT EXISTS part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT)");
    odb.prepare("INSERT INTO session (id, directory, title, time_created, time_updated) VALUES (?,?,?,?,?)").run("ses_e2e_mirror", hub.alpha, "E2E Spiegel", 1000, 2000);
    odb.prepare("INSERT INTO message VALUES (?,?,?,?,?)").run("m1", "ses_e2e_mirror", 1000, 1000, JSON.stringify({ role: "user" }));
    odb.prepare("INSERT INTO part VALUES (?,?,?,?,?,?)").run("p1", "m1", "ses_e2e_mirror", 1000, 1000, JSON.stringify({ type: "text", text: "外部のチャット — Frage vom Terminal" }));
    odb.prepare("INSERT INTO message VALUES (?,?,?,?,?)").run("m2", "ses_e2e_mirror", 2000, 2000, JSON.stringify({ role: "assistant" }));
    odb.prepare("INSERT INTO part VALUES (?,?,?,?,?,?)").run("p2", "m2", "ses_e2e_mirror", 2000, 2000, JSON.stringify({ type: "text", text: "Antwort aus dem externen Lauf" }));
    odb.close();

    await app.getByRole("button", { name: "Gefunden" }).click();
    await expandAllGroups(app);
    const row = app.locator(".discovered-row").filter({ hasText: "E2E Spiegel" });
    await expect(row).toContainText("ses_e2e_mirror");
    await row.getByRole("button", { name: "Spiegeln" }).click();
    await expect(app.locator(".session-topbar")).toContainText("opencode");
    // exact same text, in the hub chat — read-only mirror, nothing ran
    await expect(app.locator(".tail-scroll")).toContainText("Frage vom Terminal");
    await expect(app.locator(".tail-scroll")).toContainText("Antwort aus dem externen Lauf");
    const id = decodeURIComponent(app.url().split("#/sessions/")[1]!);
    const events = await hub.events(id);
    expect(events.some((e) => e.type === "user" && (e.payload as { text?: string }).text?.includes("Frage vom Terminal"))).toBe(true);
  });

  test("die Zeile nennt Titel und letzte Nachricht; die Suche findet sie, auch auf einer späteren Seite (ADR-0040)", async ({ app, hub }) => {
    const line = (o: unknown) => `${JSON.stringify(o)}\n`;
    const dir = externalClaude(hub, "-home-user-titel", ["11111111-aaaa-4aaa-8aaa-111111111111"], (id) =>
      line({ type: "user", message: { role: "user", content: "Baue den Login um" }, sessionId: id }) +
      line({ type: "ai-title", aiTitle: "Login-Umbau mit Tokenmaske" }) +
      line({ type: "last-prompt", lastPrompt: "Kannst du die Maske nach der Prüfung öffnen?" }),
    );
    expect(dir).toContain("titel");
    // 55 weitere ältere Sessions drängen den Treffer auf Seite 2
    externalClaude(hub, "-home-user-fueller", Array.from({ length: 55 }, (_, i) => `fueller-${i}`));
    const old = new Date(Date.now() - 3600_000);
    for (let i = 0; i < 55; i++) utimesSync(join(hub.root, "claude", "projects", hub.projectsDir.replace(/[^a-zA-Z0-9]/g, "-") + "-home-user-fueller", `fueller-${i}.jsonl`), old, old);
    utimesSync(join(dir, "11111111-aaaa-4aaa-8aaa-111111111111.jsonl"), new Date(Date.now() - 7200_000), new Date(Date.now() - 7200_000));

    await app.getByRole("button", { name: "Gefunden" }).click();
    await expect(app.locator(".discovered-row")).toHaveCount(50);
    await expect(app.getByText("Login-Umbau mit Tokenmaske")).toHaveCount(0);
    await app.getByLabel("Sessions durchsuchen").fill("tokenmaske");
    const row = app.locator(".discovered-row");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Login-Umbau mit Tokenmaske");
    await expect(row).toContainText("Kannst du die Maske nach der Prüfung öffnen?");
    await expect(row).toContainText("11111111-aaaa-4aaa-8aaa-111111111111");
    await app.getByLabel("Sessions durchsuchen").fill("gibt-es-nicht");
    await expect(app.getByText("keine Session passt zur Suche")).toBeVisible();
  });

  test("eine eben geschriebene Session ist als „läuft gerade woanders“ markiert und wird als Kopie fortgesetzt (ADR-0040)", async ({ app, hub }) => {
    const sid = "22222222-bbbb-4bbb-8bbb-222222222222";
    const mungedAlpha = hub.alpha.replace(/[^a-zA-Z0-9]/g, "-");
    const dir = join(hub.root, "claude", "projects", mungedAlpha);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${sid}.jsonl`), `{"type":"ai-title","aiTitle":"Gerade offen im Terminal"}\n`);

    await app.getByRole("button", { name: "Gefunden" }).click();
    await expandAllGroups(app);
    const row = app.locator(".discovered-row").filter({ hasText: "Gerade offen im Terminal" });
    await expect(row.getByText("läuft gerade woanders")).toBeVisible();
    await expect(row.getByRole("button", { name: "Fortsetzen", exact: true })).toHaveCount(0);
    await row.getByRole("button", { name: "Als Kopie fortsetzen" }).click();
    await expect(app.locator(".session-topbar")).toContainText("claude");
    const id = decodeURIComponent(app.url().split("#/sessions/")[1]!);
    const rec = (await hub.api<{ title: string | null; fork: boolean; status: string }>(`/api/sessions/${id}`)).body;
    expect(rec).toMatchObject({ title: "Gerade offen im Terminal", fork: true });
    // ohne Prompt startet nichts: die Session wartet zwischen den Zügen
    expect(rec.status).toBe("idle");
  });

  test("mehr als eine Seite wird mit „Mehr laden“ vollständig", async ({ app, hub }) => {
    externalClaude(hub, "-home-user-viele", Array.from({ length: 55 }, (_, i) => `viele-${i}`));
    await app.getByRole("button", { name: "Gefunden" }).click();
    await expect(app.locator(".discovered-row")).toHaveCount(50);
    await app.getByRole("button", { name: "Mehr laden" }).click();
    await expect(app.locator(".discovered-row")).toHaveCount(55);
    await expect(app.getByRole("button", { name: "Mehr laden" })).toHaveCount(0);
  });

  test("die Status-Seite zeigt das Harness-Inventar mit geprüfter Version (T5.1)", async ({ app }) => {
    await app.getByRole("button", { name: "Status" }).click();
    const row = app.locator(".inventory-table tr").filter({ hasText: "opencode" });
    await expect(row).toContainText("1.2.3-e2e");
    await expect(row.locator(".support").first()).toHaveText("fehlt");
    await expect(row.locator(".support").nth(1)).toHaveText("belegt");
    // deepseek = dsh via ACP (ADR-0018) — probed like any CLI, honest cells
    await expect(app.locator(".inventory-table tr").filter({ hasText: "deepseek" })).toContainText("gebaut, unbelegt");
  });
});
