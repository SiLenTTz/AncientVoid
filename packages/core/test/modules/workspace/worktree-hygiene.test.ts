import { afterEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { WorktreeManager } from "../../../src/modules/workspace/worktree.ts";
import { pruneWorktrees, scanWorktrees, type WorktreeSessionRow } from "../../../src/modules/workspace/worktree-hygiene.ts";

const git = promisify(execFile);

describe("EPIC-P14 worktree hygiene", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  async function setup() {
    const repo = await mkdtemp(join(tmpdir(), "uacc-wh-repo-"));
    const out = await mkdtemp(join(tmpdir(), "uacc-wh-out-"));
    dirs.push(repo, out);
    await git("git", ["-C", repo, "init", "-q", "-b", "main"]);
    await git("git", ["-C", repo, "config", "user.email", "t@uacc.local"]);
    await git("git", ["-C", repo, "config", "user.name", "uacc test"]);
    await writeFile(join(repo, "a.txt"), "hi\n");
    await git("git", ["-C", repo, "add", "a.txt"]);
    await git("git", ["-C", repo, "commit", "-q", "-m", "initial"]);
    const worktrees = new WorktreeManager(out);
    const row = async (id: string, over: Partial<WorktreeSessionRow>): Promise<WorktreeSessionRow> => {
      const created = await worktrees.create(id, repo);
      return { id, project: repo, status: "idle", archived: true, worktreeSha: created!.baseSha, ...over };
    };
    return { repo, worktrees, row };
  }

  it("classifies clean / work / in use / running and prunes only the safe one", async () => {
    const { worktrees, row } = await setup();
    const clean = await row("clean", {});
    const dirty = await row("dirty", {});
    await writeFile(join(worktrees.pathFor("dirty"), "new.txt"), "arbeit\n");
    const busy = await row("busy", {});
    const running = await row("running", { status: "working" });
    const active = await row("active", { archived: false, status: "idle" });
    const ended = await row("ended", { archived: false, status: "stopped" });
    const sessions = [clean, dirty, busy, running, active, ended];
    const inUse = async (path: string) => path === worktrees.pathFor("busy");

    const entries = await scanWorktrees(worktrees, sessions, inUse);
    const by = Object.fromEntries(entries.map((e) => [e.sessionId, e]));
    expect(by.clean).toMatchObject({ state: "clean", inUse: false, prunable: true });
    expect(by.dirty).toMatchObject({ state: "work", prunable: false });
    expect(by.busy).toMatchObject({ state: "clean", inUse: true, prunable: false });
    expect(by.running).toMatchObject({ prunable: false });
    expect(by.active).toMatchObject({ prunable: false }); // not archived, not ended
    expect(by.ended).toMatchObject({ prunable: true });
    expect(by.clean!.sizeBytes).toBeGreaterThan(0);

    // Dry run: reports, changes nothing on disk.
    const dry = await pruneWorktrees(worktrees, sessions, entries, inUse, false);
    expect(dry.removed.sort()).toEqual([worktrees.pathFor("clean"), worktrees.pathFor("ended")].sort());
    for (const id of ["clean", "dirty", "busy", "running", "active", "ended"]) expect(existsSync(worktrees.pathFor(id))).toBe(true);

    // Apply: only the safe two go, work stays untouched.
    const applied = await pruneWorktrees(worktrees, sessions, entries, inUse, true);
    expect(applied.failed).toEqual([]);
    expect(existsSync(worktrees.pathFor("clean"))).toBe(false);
    expect(existsSync(worktrees.pathFor("ended"))).toBe(false);
    for (const id of ["dirty", "busy", "running", "active"]) expect(existsSync(worktrees.pathFor(id))).toBe(true);
    expect(existsSync(join(worktrees.pathFor("dirty"), "new.txt"))).toBe(true);
  });

  it("re-checks right before removing: work written after the scan is kept", async () => {
    const { worktrees, row } = await setup();
    const late = await row("late", {});
    const sessions = [late];
    const entries = await scanWorktrees(worktrees, sessions, async () => false);
    expect(entries[0]!.prunable).toBe(true);
    await writeFile(join(worktrees.pathFor("late"), "later.txt"), "nachträglich\n"); // agent wrote after the scan
    const result = await pruneWorktrees(worktrees, sessions, entries, async () => false, true);
    expect(result.removed).toEqual([]);
    expect(existsSync(join(worktrees.pathFor("late"), "later.txt"))).toBe(true);
  });

  it("skips sessions whose worktree directory does not exist", async () => {
    const { worktrees } = await setup();
    const entries = await scanWorktrees(worktrees, [{ id: "gone", project: "/x", status: "idle", archived: true, worktreeSha: null }], async () => false);
    expect(entries).toEqual([]);
  });
});
