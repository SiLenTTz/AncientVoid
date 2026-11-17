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
  await app.locator(".project-tile").first().waitFor();
  for (let i = 0; i < 20; i++) {
    const next = app.locator(".project-tile:not([open]) > summary").first();
    if ((await next.count()) === 0) break;
    await next.click();
  }
  // Subagenten stehen eingeklappt unter ihrer Hauptsession (EPIC-P34 T34.7).
  for (let i = 0; i < 20; i++) {
    const next = app.locator(".discovery-subagents:not([open]) > summary").first();
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
    const rows = app.locator("[data-testid=discovered-row]");
    await expect(rows.filter({ hasText: "ext-1" })).toHaveCount(1);
    await expect(rows.filter({ hasText: "agent-9" }).getByText("Subagent von ext-2")).toBeVisible();
    await expect(rows.filter({ hasText: "extern · nur beobachtet" })).toHaveCount(4);
    await expect(rows.filter({ hasText: "Hub" }).filter({ hasNotText: "extern" })).toHaveCount(2);

    await rows.filter({ hasText: own }).locator(".session-open").click();
    await expect(app).toHaveURL(new RegExp(`#/sessions/${own}`));
    await expect(app.locator(".session-topbar")).toContainText("dummy");
  });

  test("EPIC-P34 T34.7: Worktrees landen beim Hauptprojekt, Rauschen steht eingeklappt in „Temporär & Automatisch“, Subagenten hängen an der Hauptsession @desktop", async ({ app, hub }) => {
    const cwdLine = (id: string, cwd: string) => `{"type":"user","sessionId":"${id}","cwd":${JSON.stringify(cwd)},"message":{"role":"user","content":"Aufgabe ${id}"}}\n`;
    const at = (name: string, id: string, cwd: string) => {
      const dir = join(hub.root, "claude", "projects", name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${id}.jsonl`), cwdLine(id, cwd));
      return dir;
    };
    at("-roh-haupt", "haupt-1", hub.alpha);
    const wt = at("-roh-worktree", "wt-1", `${hub.alpha}/data/worktrees/feat-abc`);
    at("-roh-fabrik", "fab-1", `${hub.alpha}/harnez-exec-7`);
    mkdirSync(join(wt, "wt-1", "subagents"), { recursive: true });
    writeFileSync(join(wt, "wt-1", "subagents", "agent-5.jsonl"), "{}\n");

    await app.getByRole("button", { name: "Gefunden" }).click();
    const tiles = app.locator(".project-tile");
    await expect(tiles).toHaveCount(2);
    const project = tiles.first();
    await expect(project.locator("> summary")).toContainText(hub.alpha.split("/").pop()!);
    await expect(project.locator("> summary")).toContainText("3 Sessionen");
    await expect(project.locator("[data-testid=discovered-row]").filter({ hasText: "Aufgabe wt-1" })).toContainText("Worktree feat-abc");
    // Der Subagent steht unter wt-1 statt als gleichrangige Karte.
    await expect(project.locator(".discovery-thread").filter({ hasText: "Aufgabe wt-1" }).locator(".discovery-subagents > summary")).toHaveText("1 Subagent");
    // Rauschen: eigene Gruppe am Ende, eingeklappt, Zähler sichtbar.
    const noise = tiles.last();
    await expect(noise.locator("> summary")).toContainText("Temporär & Automatisch");
    await expect(noise.locator("> summary")).toContainText("1 Session");
    await expect(noise).not.toHaveAttribute("open", "");
    await noise.locator("> summary").click();
    await expect(noise.locator("[data-testid=discovered-row]")).toContainText("fab-1");
  });

  test("EPIC-P34 T34.8: Codex- und Hermes-Sessions werden gefunden, Codex nur beobachtet @desktop", async ({ app, hub }) => {
    const codexDir = join(hub.root, "codex-sessions", "2026", "11", "06");
    mkdirSync(codexDir, { recursive: true });
    const id = "01a00000-0000-7000-8000-00000000e2e1";
    const row = (o: unknown) => `${JSON.stringify(o)}\n`;
    writeFileSync(
      join(codexDir, `rollout-2026-11-06T09-00-00-${id}.jsonl`),
      row({ type: "session_meta", payload: { id, cwd: hub.alpha, source: "vscode" } }) +
        row({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Codex Aufgabe E2E" }] } }),
    );
    const hermes = join(hub.root, "hermes-home");
    mkdirSync(hermes, { recursive: true });
    const db = new DatabaseSync(join(hermes, "state.db"));
    db.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT NOT NULL, started_at REAL NOT NULL, cwd TEXT, title TEXT)");
    db.prepare("INSERT INTO sessions (id, source, started_at, cwd, title) VALUES (?,?,?,?,?)").run("20261106_090000_e2e", "cli", 1_790_000_000, hub.alpha, "Hermes Aufgabe E2E");
    db.close();

    await app.getByRole("button", { name: "Gefunden" }).click();
    await expandAllGroups(app);
    const rows = app.locator("[data-testid=discovered-row]");
    const codex = rows.filter({ hasText: "Codex Aufgabe E2E" });
    await expect(codex).toContainText("codex");
    await expect(codex).toContainText("Nur beobachtet");
    await expect(codex.getByRole("button", { name: /Fortsetzen/ })).toHaveCount(0);
    await expect(rows.filter({ hasText: "Hermes Aufgabe E2E" })).toContainText("hermes");
  });

  /** Je ein Fund pro Zustand: läuft woanders (frisch), fortsetzbar (alt), nur beobachtet (Codex), im Hub. */
  async function seedStates(hub: TestHub) {
    const cwdLine = (id: string, text: string) => `{"type":"user","sessionId":"${id}","cwd":${JSON.stringify(hub.alpha)},"message":{"role":"user","content":"${text}"}}\n`;
    const dir = join(hub.root, "claude", "projects", "-roh-zustaende");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "frisch.jsonl"), cwdLine("frisch", "Gerade offen"));
    writeFileSync(join(dir, "alt.jsonl"), cwdLine("alt", "Lange Aufgabe mit einem recht langen Titel, der über mehrere Zeilen laufen muss und deshalb gekürzt wird, damit die Karte gleich hoch bleibt"));
    const old = new Date(Date.now() - 3 * 3600_000);
    utimesSync(join(dir, "alt.jsonl"), old, old);
    const codexDir = join(hub.root, "codex-sessions", "2026", "11", "06");
    mkdirSync(codexDir, { recursive: true });
    const id = "01a00000-0000-7000-8000-00000000d3d3";
    const rollout = join(codexDir, `rollout-2026-11-06T09-00-00-${id}.jsonl`);
    writeFileSync(rollout, `{"type":"session_meta","payload":{"id":"${id}","cwd":${JSON.stringify(hub.alpha)},"source":"vscode"}}\n`);
    utimesSync(rollout, old, old);
    await hub.createSession({ adapter: "dummy" });
  }

  test("EPIC-P34 T34.9: Kennzahl-Kacheln zählen und filtern, Provider-Chips filtern, Zustand steht als Text", async ({ app, hub }) => {
    await seedStates(hub);
    await app.getByRole("button", { name: "Gefunden" }).click();
    const kpi = (name: string) => app.locator(".discovery-kpi").filter({ hasText: name });
    await expect(kpi("Läuft gerade").locator(".discovery-kpi-count")).toHaveText("1");
    await expect(kpi("Fortsetzbar").locator(".discovery-kpi-count")).toHaveText("1");
    await expect(kpi("Nur beobachtet").locator(".discovery-kpi-count")).toHaveText("1");
    await expect(kpi("Im Hub").locator(".discovery-kpi-count")).toHaveText("1");
    await expandAllGroups(app);
    const rows = app.locator("[data-testid=discovered-row]");
    await expect(rows).toHaveCount(4);
    await expect(rows.filter({ hasText: "Gerade offen" }).locator(".discovery-state")).toHaveText("läuft gerade woanders");

    await kpi("Nur beobachtet").click();
    await expect(kpi("Nur beobachtet")).toHaveAttribute("aria-pressed", "true");
    await expect(rows).toHaveCount(1);
    await expect(app.getByText("1 von 4 gefunden")).toBeVisible();
    await kpi("Nur beobachtet").click();
    await expect(rows).toHaveCount(4);

    await app.getByRole("button", { name: /^claude/ }).click();
    await expect(rows).toHaveCount(2);
    await app.getByRole("button", { name: /^claude/ }).click();
    await kpi("Im Hub").click();
    await kpi("Läuft gerade").click();
    await expect(app.getByText("keine Session passt zum Filter")).toHaveCount(0);
    await expect(rows).toHaveCount(1);
  });

  test("EPIC-P34 T34.9: alle Karten einer Gruppe sind gleich hoch, nichts läuft seitwärts über @desktop", async ({ app, hub }) => {
    await seedStates(hub);
    await app.getByRole("button", { name: "Gefunden" }).click();
    await expandAllGroups(app);
    const cards = app.locator(".discovery-card");
    await expect(cards).toHaveCount(4);
    const geometry = await cards.evaluateAll((els) => els.map((el) => ({ h: Math.round(el.getBoundingClientRect().height), top: Math.round(el.getBoundingClientRect().top), right: el.getBoundingClientRect().right })));
    expect(new Set(geometry.map((g) => g.h)).size, JSON.stringify(geometry)).toBe(1);
    expect(await app.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    // EPIC-P47 §3.4: Die Discovery steht seit T47.5 als Umschalt-State in der Übersichtsspalte — dort eingleisig;
    // das zweispaltige Raster der ehemaligen Werkzeugfläche gibt es nicht mehr. Gleichhöhe bleibt die Kernaussage.
    const columns = new Set(geometry.map((g) => g.top)).size < geometry.length;
    expect(columns).toBe(false);
  });

  test("EPIC-P34 T34.9: das ⋯-Menü zeigt ID und Harness und kopiert die ID @desktop", async ({ app, hub }) => {
    await app.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await seedStates(hub);
    await app.getByRole("button", { name: "Gefunden" }).click();
    await expandAllGroups(app);
    const card = app.locator("[data-testid=discovered-row]").filter({ hasText: "Lange Aufgabe" });
    await expect(card.locator(".card-menu-body")).toBeHidden();
    await card.getByLabel("Weitere Angaben und Aktionen").click();
    await expect(card.locator(".card-menu-body")).toContainText("alt");
    await expect(card.locator(".card-menu-body")).toContainText("cli");
    await card.getByRole("button", { name: "ID kopieren" }).click();
    await expect(card.getByRole("button", { name: "Kopiert" })).toBeVisible();
    expect(await app.evaluate(() => navigator.clipboard.readText())).toBe("alt");
    // Aktionen und Menü liegen in derselben Zeile.
    const [action, menu] = await Promise.all([card.getByRole("button", { name: "Fortsetzen", exact: true }).boundingBox(), card.getByLabel("Weitere Angaben und Aktionen").boundingBox()]);
    expect(Math.abs((action!.y + action!.height / 2) - (menu!.y + menu!.height / 2))).toBeLessThan(6);
  });

  test("AC-P5-1: 20 Sessions, je zwei pro Projekt, sind binnen 10 s vollständig sichtbar", async ({ app, hub }, info) => {
    for (const project of [hub.alpha, hub.beta]) for (let i = 0; i < 5; i++) await hub.createSession({ adapter: "dummy", project });
    for (let p = 1; p <= 5; p++) externalClaude(hub, `-home-user-extern-${p}`, [`ext-${p}-a`, `ext-${p}-b`]);
    const t0 = Date.now();
    await app.getByRole("button", { name: "Gefunden" }).click();
    await expect(app.getByText("20 gefunden")).toBeVisible({ timeout: 10_000 });
    await expandAllGroups(app);
    await expect(app.locator("[data-testid=discovered-row]")).toHaveCount(20);
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
    const row = app.locator("[data-testid=discovered-row]").filter({ hasText: "agent-9" });
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
    const row = app.locator("[data-testid=discovered-row]").filter({ hasText: "E2E Spiegel" });
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
    await expect(app.locator("[data-testid=discovered-row]")).toHaveCount(50);
    await expect(app.getByText("Login-Umbau mit Tokenmaske")).toHaveCount(0);
    await app.getByLabel("Sessions durchsuchen").fill("tokenmaske");
    const row = app.locator("[data-testid=discovered-row]");
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
    const row = app.locator("[data-testid=discovered-row]").filter({ hasText: "Gerade offen im Terminal" });
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

  test("pi, oh-my-pi und maki: Sessions erscheinen mit Titel; nur ein registrierter Harness bietet Fortsetzen an (ADR-0041)", async ({ app, hub }) => {
    const line = (o: unknown) => `${JSON.stringify(o)}\n`;
    const msg = (text: string) => line({ type: "message", message: { role: "user", content: [{ type: "text", text }] } });
    const piId = "01a18324-aaaa-7000-8000-000000000001";
    const ompId = "01a18324-bbbb-7000-8000-000000000002";
    mkdirSync(join(hub.root, "pi-sessions", "--p--"), { recursive: true });
    mkdirSync(join(hub.root, "omp-sessions", "-p"), { recursive: true });
    mkdirSync(join(hub.root, "maki-sessions"), { recursive: true });
    writeFileSync(join(hub.root, "pi-sessions", "--p--", `t_${piId}.jsonl`), line({ type: "session", id: piId, cwd: hub.alpha }) + msg("Pi: Login prüfen"));
    writeFileSync(join(hub.root, "omp-sessions", "-p", `t_${ompId}.jsonl`), line({ type: "title", v: 1, title: "Omp: Importer reparieren", pad: " ".repeat(120) }) + line({ type: "session", id: ompId, cwd: hub.alpha }) + msg("egal"));
    writeFileSync(
      join(hub.root, "maki-sessions", "MakiSession1.jsonl"),
      line({ t: "header", v: 2, id: "MakiSession1", model: "zai/glm-5.3", cwd: hub.alpha, created_at: 1 }) + line({ t: "msg", d: { role: "user", content: [{ type: "text", text: "Maki: Doku schreiben" }] } }) + line({ t: "meta", title: "Maki: Doku schreiben", updated_at: 2 }),
    );
    for (const f of [join(hub.root, "pi-sessions", "--p--", `t_${piId}.jsonl`), join(hub.root, "omp-sessions", "-p", `t_${ompId}.jsonl`), join(hub.root, "maki-sessions", "MakiSession1.jsonl")]) utimesSync(f, new Date(Date.now() - 3600_000), new Date(Date.now() - 3600_000));

    await app.getByRole("button", { name: "Gefunden" }).click();
    await expandAllGroups(app);
    const pi = app.locator("[data-testid=discovered-row]").filter({ hasText: "Pi: Login prüfen" });
    const omp = app.locator("[data-testid=discovered-row]").filter({ hasText: "Omp: Importer reparieren" });
    const maki = app.locator("[data-testid=discovered-row]").filter({ hasText: "Maki: Doku schreiben" });
    await expect(pi).toContainText("pi");
    await expect(omp).toContainText("omp");
    await expect(maki).toContainText("maki");
    // pi ist im Test-Hub registriert, omp und maki nicht: ohne Adapter kein Fortsetzen
    await expect(pi.getByRole("button", { name: "Fortsetzen", exact: true })).toBeVisible();
    await expect(omp.getByRole("button", { name: "Fortsetzen", exact: true })).toHaveCount(0);
    await expect(maki.getByRole("button", { name: "Fortsetzen", exact: true })).toHaveCount(0);
    await app.getByLabel("Sessions durchsuchen").fill("importer");
    await expect(app.locator("[data-testid=discovered-row]")).toHaveCount(1);
  });

  test("mehr als eine Seite wird mit „Mehr laden“ vollständig", async ({ app, hub }) => {
    externalClaude(hub, "-home-user-viele", Array.from({ length: 55 }, (_, i) => `viele-${i}`));
    await app.getByRole("button", { name: "Gefunden" }).click();
    await expect(app.locator("[data-testid=discovered-row]")).toHaveCount(50);
    await app.getByRole("button", { name: "Mehr laden" }).click();
    await expect(app.locator("[data-testid=discovered-row]")).toHaveCount(55);
    await expect(app.getByRole("button", { name: "Mehr laden" })).toHaveCount(0);
  });

  test("die Status-Seite zeigt das Harness-Inventar mit geprüfter Version (T5.1)", async ({ app }) => {
    await app.getByRole("button", { name: "Status" }).click();
    const row = app.locator(".inventory-table tr").filter({ hasText: "opencode" });
    await expect(row).toContainText("1.2.3-e2e");
    // EPIC-P35 T35.6: opencode discovery ist belegt (SQLite-Scanner, live
    // 2026-11-07) — beide Zellen ehrlich grün, statt alter „fehlt"-Reste.
    await expect(row.locator(".support").first()).toHaveText("belegt");
    await expect(row.locator(".support").nth(1)).toHaveText("belegt");
    // deepseek = dsh via ACP (ADR-0018) — probed like any CLI, honest cells
    await expect(app.locator(".inventory-table tr").filter({ hasText: "deepseek" })).toContainText("gebaut, unbelegt");
  });
});
