import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyProject } from "../../../src/modules/discovery/project-origin.ts";
import { claudeDiscoverySource, scanClaudeSessions } from "../../../src/modules/discovery/sources.ts";

const line = (o: unknown) => `${JSON.stringify(o)}\n`;
const noGit = () => null;

describe("classifyProject (EPIC-P34 T34.7)", () => {
  it("ein normaler Pfad ist sein eigenes Projekt", () => {
    expect(classifyProject("/home/x/work/app", noGit)).toEqual({ project: "/home/x/work/app", worktree: null, temporary: false });
  });

  it("bündelt Worktrees unter data/worktrees und .claude/worktrees beim Hauptprojekt", () => {
    expect(classifyProject("/r/AncientVoid/data/worktrees/5d87c1d3", noGit)).toEqual({ project: "/r/AncientVoid", worktree: "5d87c1d3", temporary: false });
    expect(classifyProject("/r/App/.claude/worktrees/feat-x/packages/core", noGit)).toEqual({ project: "/r/App", worktree: "feat-x", temporary: false });
  });

  it("liest bei einem git-Worktree das Hauptprojekt aus der .git-Datei", () => {
    const read = (dir: string) => (dir === "/w/side" ? "gitdir: /w/main/.git/worktrees/side\n" : null);
    expect(classifyProject("/w/side", read)).toEqual({ project: "/w/main", worktree: "side", temporary: false });
  });

  it("ein unbekanntes Muster bleibt eigene Gruppe — nie geraten", () => {
    expect(classifyProject("/r/worktrees-archiv/x", noGit)).toMatchObject({ project: "/r/worktrees-archiv/x", worktree: null });
    expect(classifyProject("/r/a", () => "gitdir: /irgendwo/anders")).toMatchObject({ project: "/r/a", worktree: null });
  });

  it("Pfade unter /tmp und Fabrik-Kopien gelten als temporär", () => {
    expect(classifyProject("/tmp/harnez-exec-abc/work", noGit).temporary).toBe(true);
    expect(classifyProject("/var/tmp/x", noGit).temporary).toBe(true);
    expect(classifyProject("/r/harnez-exec-1/app", noGit).temporary).toBe(true);
    expect(classifyProject("/tmpfoo/x", noGit).temporary).toBe(false);
  });

  it("ein Worktree eines temporären Hauptprojekts ist temporär", () => {
    expect(classifyProject("/tmp/p/data/worktrees/a", noGit)).toEqual({ project: "/tmp/p", worktree: "a", temporary: true });
  });
});

describe("Scan: echtes Projekt aus dem Transkript (EPIC-P34 T34.7)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const claudeDir = () => {
    const d = mkdtempSync(join(tmpdir(), "p34-scan-"));
    dirs.push(d);
    return d;
  };
  const write = (dir: string, munged: string, file: string, cwd: string | null, extra: unknown[] = []) => {
    const proj = join(dir, "projects", munged);
    mkdirSync(proj, { recursive: true });
    writeFileSync(join(proj, file), line({ type: "user", cwd, message: { role: "user", content: "Frage" } }) + extra.map(line).join(""));
    return proj;
  };

  it("cwd hat Vorrang vor dem Ordnernamen; Worktrees landen beim Hauptprojekt", () => {
    const dir = claudeDir();
    write(dir, "-r-AncientVoid-data-worktrees-5d87", "a.jsonl", "/r/AncientVoid/data/worktrees/5d87");
    write(dir, "-r-AncientVoid", "b.jsonl", "/r/AncientVoid");
    const items = scanClaudeSessions(dir, new Date().toISOString(), []);
    const byId = Object.fromEntries(items.map((i) => [i.nativeSessionId, i]));
    expect(byId.a).toMatchObject({ project: "/r/AncientVoid", worktree: "5d87", temporary: false });
    expect(byId.b).toMatchObject({ project: "/r/AncientVoid", worktree: null });
  });

  it("ohne cwd bleibt der Rohname sichtbar (R9.7), ein -tmp--Name zählt als temporär", () => {
    const dir = claudeDir();
    write(dir, "-tmp-harnez-exec-1", "a.jsonl", null);
    write(dir, "-home-x-app", "b.jsonl", null);
    const byId = Object.fromEntries(scanClaudeSessions(dir, new Date().toISOString(), []).map((i) => [i.nativeSessionId, i]));
    expect(byId.a).toMatchObject({ project: "-tmp-harnez-exec-1", temporary: true });
    expect(byId.b).toMatchObject({ project: "-home-x-app", temporary: false });
  });

  it("ein Subagent erbt Projekt und Worktree seiner Hauptsession und behält die Eltern-ID", () => {
    const dir = claudeDir();
    const proj = write(dir, "-r-App-data-worktrees-w1", "main1.jsonl", "/r/App/data/worktrees/w1");
    mkdirSync(join(proj, "main1", "subagents"), { recursive: true });
    writeFileSync(join(proj, "main1", "subagents", "agent-x.jsonl"), line({ type: "user", isSidechain: true, message: { role: "user", content: "intern" } }));
    const sub = scanClaudeSessions(dir, new Date().toISOString(), []).find((i) => i.nativeSessionId === "agent-x");
    expect(sub).toMatchObject({ parentSessionId: "main1", project: "/r/App", worktree: "w1" });
  });

  it("live: ein offenes, aber seit Minuten stilles Terminal gilt über die Liste von `claude agents`", () => {
    const dir = claudeDir();
    const proj = write(dir, "-r-App", "idle.jsonl", "/r/App");
    const old = new Date(Date.now() - 20 * 60_000);
    utimesSync(join(proj, "idle.jsonl"), old, old);
    expect(statSync(join(proj, "idle.jsonl")).mtimeMs).toBeLessThan(Date.now() - 600_000);
    const now = new Date().toISOString();
    expect(scanClaudeSessions(dir, now, [])[0]!.live).toBe(false);
    expect(scanClaudeSessions(dir, now, [], new Set(["idle"]))[0]!.live).toBe(true);
  });

  it("unter einer konfigurierten Wurzel ist nichts temporär, auch wenn die Wurzel in /tmp liegt", async () => {
    const dir = claudeDir();
    const root = join(dir, "work");
    write(dir, "-x-a", "a.jsonl", join(root, "app"));
    write(dir, "-x-b", "b.jsonl", "/tmp/harnez-exec-9/app");
    const rootless = await claudeDiscoverySource(dir).list();
    expect(rootless.every((i) => i.temporary)).toBe(true);
    const rooted = await claudeDiscoverySource(dir, [root]).list();
    expect(rooted.map((i) => [i.nativeSessionId, i.temporary])).toEqual([["a", false]]);
  });
});
