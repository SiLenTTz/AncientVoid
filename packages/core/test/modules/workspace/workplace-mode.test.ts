import { basicFeatures } from "@ancientvoid/contracts";
import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStore } from "../../../src/platform/eventstore.ts";
import { SessionManager } from "../../../src/modules/sessions/session-manager.ts";
import { AdapterRegistry } from "../../../src/modules/harness/registry.ts";
import { HubDatabase } from "../../../src/platform/db.ts";
import { WorktreeManager } from "../../../src/modules/workspace/worktree.ts";
import { canonicalCheckout, CheckoutLeaseStore } from "../../../src/modules/workspace/checkout.ts";
import { ProcessRunner } from "@ancientvoid/workers";

const execFileAsync = promisify(execFile);

/** EPIC-P38 (ADR-0057): Arbeitsort, Writer-Lease, Dirty-Bestätigung, Baseline. */
describe("EPIC-P38: Arbeitsort", () => {
  async function fixture(dbFile?: string) {
    const repo = await mkdtemp(join(tmpdir(), "ancientvoid-p38-repo-"));
    const out = await mkdtemp(join(tmpdir(), "ancientvoid-p38-out-"));
    const eventsDir = await mkdtemp(join(tmpdir(), "ancientvoid-p38-ev-"));
    const git = (...args: string[]) => execFileAsync("git", ["-C", repo, ...args]);
    await git("init", "-q", "-b", "main");
    await git("config", "user.email", "t@ancientvoid.local");
    await git("config", "user.name", "ancientvoid test");
    await writeFile(join(repo, "a.txt"), "tracked\n");
    await writeFile(join(repo, "sentinel.txt"), "bleibt\n");
    await git("add", "-A");
    await git("commit", "-q", "-m", "initial");
    const seen = { workdirs: [] as string[] };
    const registry = new AdapterRegistry();
    registry.register("p38", () => ({
      id: "p38",
      version: "0.0.1",
      capabilities: () => ({
        reasoning: false, tools: false, cost: false, steer: false, usage: false,
        nativeDiscovery: "none", nativeResume: "none",
        features: basicFeatures({ followUp: true, interrupt: false }),
      }),
      async start(_spec, ctx) {
        seen.workdirs.push(ctx.workdir);
        return { sessionId: ctx.sessionId };
      },
      async steer() { return { ok: true }; },
      async status() { return { state: "healthy" as const }; },
      async stop() {},
    }));
    const db = new HubDatabase(dbFile ?? ":memory:");
    const manager = new SessionManager(db, new EventStore(eventsDir), registry, new ProcessRunner(), undefined, new WorktreeManager(out));
    return { repo, out, manager, seen, git, db };
  }

  it("Standard bleibt eigener Worktree und steht im Record", async () => {
    const { repo, manager, seen } = await fixture();
    const rec = await manager.create({ adapter: "p38", project: repo });
    expect(rec.workspaceMode).toBe("worktree");
    expect(rec.worktreeSha).not.toBeNull();
    expect(seen.workdirs[0]).not.toBe(repo);
  });

  it("direkt arbeitet exakt im kanonischen Checkout, ohne Worktree", async () => {
    const { repo, manager, seen } = await fixture();
    const rec = await manager.create({ adapter: "p38", project: repo, workspaceMode: "direct" });
    expect(rec.workspaceMode).toBe("direct");
    expect(rec.worktreeSha).toBeNull();
    expect(rec.workspaceBaseline?.checkoutId).toBe((await canonicalCheckout(repo)).checkoutId);
    expect(seen.workdirs[0]).toBe(repo);
  });

  it("zweiter direkter Schreiber wird vor Spawn verweigert — auch über Symlink und Unterordner", async () => {
    const { repo, manager, seen } = await fixture();
    await manager.create({ adapter: "p38", project: repo, workspaceMode: "direct" });
    await mkdir(join(repo, "sub"));
    await expect(manager.create({ adapter: "p38", project: join(repo, "sub"), workspaceMode: "direct" })).rejects.toThrow(/schreibt bereits/);
    // Windows ohne Entwicklermodus erlaubt keine Symlinks (EPERM) — dann eben ohne
    // diesen Teil prüfen, statt den Fall rot werden zu lassen (sichtbarer Verzicht).
    const link = join(await mkdtemp(join(tmpdir(), "ancientvoid-p38-link-")), "lnk");
    let symlinkOk = true;
    try {
      await symlink(repo, link);
    } catch {
      symlinkOk = false;
    }
    if (symlinkOk) await expect(manager.create({ adapter: "p38", project: link, workspaceMode: "direct" })).rejects.toThrow(/schreibt bereits/);
    expect(seen.workdirs).toHaveLength(1);
    // ein eigener Worktree desselben Projekts bleibt daneben möglich
    const wt = await manager.create({ adapter: "p38", project: repo });
    expect(wt.workspaceMode).toBe("worktree");
  });

  it("Stop gibt die Lease frei, löscht aber nie das Projekt; Lease eines toten Eigentümers wird abgelöst", async () => {
    const { repo, manager } = await fixture();
    const first = await manager.create({ adapter: "p38", project: repo, workspaceMode: "direct" });
    await manager.stop(first.id);
    expect(existsSync(join(repo, "sentinel.txt"))).toBe(true);
    const second = await manager.create({ adapter: "p38", project: repo, workspaceMode: "direct" });
    expect((await manager.workplaceStatus(second.id))?.leaseGeneration).toBe(2);
  });

  it("Resume einer gestoppten direkten Session scheitert sichtbar, wenn der Checkout inzwischen belegt ist", async () => {
    const { repo, manager } = await fixture();
    const first = await manager.create({ adapter: "p38", project: repo, workspaceMode: "direct" });
    await manager.stop(first.id);
    await manager.create({ adapter: "p38", project: repo, workspaceMode: "direct" });
    const ack = await manager.steer(first.id, { kind: "prompt", text: "weiter" });
    expect(ack.ok).toBe(false);
    expect(ack.detail).toMatch(/schreibt bereits/);
    expect(manager.get(first.id)?.workspaceMode).toBe("direct"); // kein stiller Wechsel
  });

  it("Dirty-Start braucht Bestätigung; Baseline hält bestehende Änderungen fest und nichts wird gestasht", async () => {
    const { repo, manager, git } = await fixture();
    await writeFile(join(repo, "a.txt"), "fremde Änderung\n");
    await writeFile(join(repo, "neu.txt"), "untracked\n");
    await expect(manager.create({ adapter: "p38", project: repo, workspaceMode: "direct" })).rejects.toThrow(/ungesicherte Änderungen/);
    const rec = await manager.create({ adapter: "p38", project: repo, workspaceMode: "direct", confirmDirty: true });
    expect(rec.workspaceBaseline?.dirty.sort()).toEqual(["a.txt", "neu.txt"]);
    const { stdout } = await git("status", "--porcelain");
    expect(stdout).toContain("a.txt");
    expect((await git("stash", "list")).stdout.trim()).toBe("");
  });

  it("HEAD-/Branch-Drift wird gegen die Baseline erkannt", async () => {
    const { repo, manager, git } = await fixture();
    const rec = await manager.create({ adapter: "p38", project: repo, workspaceMode: "direct" });
    expect((await manager.workplaceStatus(rec.id))?.drift).toMatchObject({ headMoved: false, branchChanged: false });
    await git("checkout", "-q", "-b", "andere");
    await writeFile(join(repo, "b.txt"), "x\n");
    await git("add", "-A");
    await git("commit", "-q", "-m", "weiter");
    expect((await manager.workplaceStatus(rec.id))?.drift).toMatchObject({ headMoved: true, branchChanged: true, branch: "andere" });
  });

  it("BUG-0174 (ADR-0081): zweiter Schreiber im Nicht-Git-Ordner braucht Bestätigung, sonst bleibt er allein", async () => {
    const { out, manager, db } = await fixture();
    const ordner = join(out, "ohne-git-ordner");
    await mkdir(ordner);
    const erste = await manager.create({ adapter: "p38", project: ordner, workspaceMode: "direct" });
    await expect(manager.create({ adapter: "p38", project: ordner, workspaceMode: "direct" }))
      .rejects.toThrow(/Mehrere Sessions in diesem Ordner/);
    expect(manager.list().filter((s) => s.project === ordner)).toHaveLength(1);
    const zweite = await manager.create({ adapter: "p38", project: ordner, workspaceMode: "direct", confirmSharedFolder: true });
    expect(zweite.workspaceMode).toBe("direct");
    expect(manager.list().filter((s) => s.project === ordner)).toHaveLength(2);
    const { checkoutId } = await canonicalCheckout(ordner);
    const tenants = db.prepare("SELECT session_id FROM checkout_tenants WHERE checkout_id = ?").all(checkoutId) as { session_id: string }[];
    expect(tenants.map((r) => r.session_id)).toEqual([zweite.id]);
    const vorschau = await manager.workplacePreview(ordner);
    expect([...(vorschau.holders ?? [])].sort()).toEqual([erste.id, zweite.id].sort());
  });

  it("BUG-0174: Git-Projekte bleiben Allein-Schreiber — die Bestätigung greift dort nicht", async () => {
    const { repo, manager } = await fixture();
    await manager.create({ adapter: "p38", project: repo, workspaceMode: "direct" });
    await expect(manager.create({ adapter: "p38", project: repo, workspaceMode: "direct", confirmSharedFolder: true }))
      .rejects.toThrow(/eigenen Worktree/);
  });

  it("BUG-0174: Stop einer Mit-Nutzung endet mit ihr (Zeile weg, Vorschau frei)", async () => {
    const { out, manager, db } = await fixture();
    const ordner = join(out, "mitnutzer-ordner");
    await mkdir(ordner);
    await manager.create({ adapter: "p38", project: ordner, workspaceMode: "direct" });
    const zweite = await manager.create({ adapter: "p38", project: ordner, workspaceMode: "direct", confirmSharedFolder: true });
    const erste = manager.list().find((s) => s.id !== zweite.id)!;
    await manager.stop(zweite.id);
    const { checkoutId } = await canonicalCheckout(ordner);
    expect(db.prepare("SELECT session_id FROM checkout_tenants WHERE checkout_id = ?").all(checkoutId)).toEqual([]);
    // Die Primär-Lease der ersten Session bleibt, nur die Mit-Nutzung endet.
    expect((await manager.workplacePreview(ordner)).holders).toEqual([erste.id]);
  });

  it("explizit „worktree“ auf Nicht-Git scheitert vor Spawn; direkt geht, der Standard fällt sichtbar zurück", async () => {
    const { manager, seen } = await fixture();
    const plain = await mkdtemp(join(tmpdir(), "ancientvoid-p38-plain-"));
    await expect(manager.create({ adapter: "p38", project: plain, workspaceMode: "worktree" })).rejects.toThrow(/Git-Projekt/);
    expect(seen.workdirs).toHaveLength(0);
    const direct = await manager.create({ adapter: "p38", project: plain, workspaceMode: "direct" });
    expect(direct.workspaceMode).toBe("direct");
    const fallback = await manager.create({ adapter: "p38", project: await mkdtemp(join(tmpdir(), "ancientvoid-p38-plain2-")) });
    expect(fallback.workspaceMode).toBe("direct");
  });

  it("Archivieren und Löschen einer direkten Session lässt das Projekt unberührt und gibt die Lease frei (K7: nach Neustart)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-p38-db-"));
    const dbFile = join(dir, "hub.db");
    const { repo, manager } = await fixture(dbFile);
    const rec = await manager.create({ adapter: "p38", project: repo, workspaceMode: "direct" });
    await manager.stop(rec.id);
    await manager.archive(rec.id, true);
    await manager.delete(rec.id);
    expect(existsSync(join(repo, "sentinel.txt"))).toBe(true);
    expect(existsSync(join(repo, ".git"))).toBe(true);
    const again = await manager.create({ adapter: "p38", project: repo, workspaceMode: "direct" });
    expect(again.workspaceMode).toBe("direct");
  });

  it("Migration 30: Altzeilen mit Worktree-Beleg → worktree, ohne Beleg → unknown (nichts geraten)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-p38-mig-"));
    const file = join(dir, "hub.db");
    const old = new HubDatabase(file);
    // Schema auf Stand 29 zurücksetzen, Altdaten einfügen, neu öffnen
    old.prepare("DROP TABLE checkout_leases").run();
    old.prepare("ALTER TABLE sessions DROP COLUMN workspace_mode").run();
    old.prepare("ALTER TABLE sessions DROP COLUMN workspace_baseline").run();
    old.prepare("DELETE FROM _migrations WHERE id = 30").run();
    const insert = (id: string, sha: string | null) =>
      old.prepare("INSERT INTO sessions (id, adapter, project, worktree_sha, status, created_at, adapter_version, updated_at) VALUES (?, 'x', '/p', ?, 'stopped', 't', '1', 't')").run(id, sha);
    insert("mit", "abc");
    insert("ohne", null);
    old.close();
    const migrated = new HubDatabase(file);
    const mode = (id: string) => (migrated.prepare("SELECT workspace_mode AS m FROM sessions WHERE id = ?").get(id) as { m: string | null }).m;
    expect(mode("mit")).toBe("worktree");
    expect(mode("ohne")).toBeNull();
    const { rowToRecord } = await import("../../../src/modules/sessions/session-row.ts");
    const row = migrated.prepare("SELECT * FROM sessions WHERE id = 'ohne'").get() as unknown as Parameters<typeof rowToRecord>[0];
    expect(rowToRecord(row).workspaceMode).toBe("unknown");
  });
});

describe("CheckoutLeaseStore: holders nennt nur lebendige Mit-Schreiber (PR-Review, ADR-0081)", () => {
  it("filtert tote Sessions heraus — sonst erzwingt die Preview Überschreib-Bestätigung ohne Gegenüber", () => {
    const db = new HubDatabase(":memory:");
    const store = new CheckoutLeaseStore(db);
    store.acquire("co-x", "ses-alt", () => false); // toter Vorbesitzer: Lease wird übernommen
    store.addTenant("co-x", "ses-tot");
    expect(store.holders("co-x")).toEqual(["ses-alt", "ses-tot"]); // ohne Filter: alle Zeilen
    expect(store.holders("co-x", undefined, () => false)).toEqual([]); // alle tot → niemand schreibt mit
    expect(store.holders("co-x", undefined, (id) => id === "ses-alt")).toEqual(["ses-alt"]); // nur der Lebendige zählt
  });
});
