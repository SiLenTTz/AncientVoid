import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Adapter, MainSyncSettings } from "@ancientvoid/contracts";
import { basicFeatures, MAIN_SYNC_DEFAULTS } from "@ancientvoid/contracts";
import { EventStore, HubDatabase, SessionManager, AdapterRegistry, WorktreeManager } from "../../../src/index.ts";
import { ProcessRunner } from "@ancientvoid/workers";

const execFileAsync = promisify(execFile);

/** Bare-"origin" + Projekt-Klon, wie das Forge-Integration-Test-Muster (T67.2-Auftragstext). */
async function mkProject(base: string, name: string): Promise<{ repo: string; origin: string }> {
  const origin = join(base, `${name}-origin.git`);
  await execFileAsync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  const repo = join(base, `${name}-repo`);
  await execFileAsync("git", ["init", "-q", "-b", "main", repo]);
  await execFileAsync("git", ["-C", repo, "config", "user.email", "test@ancientvoid.local"]);
  await execFileAsync("git", ["-C", repo, "config", "user.name", "ancientvoid test"]);
  await execFileAsync("git", ["-C", repo, "remote", "add", "origin", origin]);
  await commit(repo, "initial", "a.txt");
  await execFileAsync("git", ["-C", repo, "push", "-q", "-u", "origin", "main"]);
  return { repo, origin };
}

async function commit(repo: string, message: string, file: string): Promise<string> {
  await writeFile(join(repo, file), `${message}\n`);
  await execFileAsync("git", ["-C", repo, "add", "-A"]);
  await execFileAsync("git", ["-C", repo, "commit", "-q", "-m", message]);
  const { stdout } = await execFileAsync("git", ["-C", repo, "rev-parse", "HEAD"]);
  return stdout.trim();
}

/** Lässt `origin` vorrücken, OHNE das Projekt zu aktualisieren — der veraltete Haupt-Checkout. */
async function advanceOrigin(origin: string, base: string, name: string, message: string): Promise<string> {
  const other = join(base, `${name}-other`);
  await execFileAsync("git", ["clone", "-q", origin, other]);
  await execFileAsync("git", ["-C", other, "config", "user.email", "other@ancientvoid.local"]);
  await execFileAsync("git", ["-C", other, "config", "user.name", "ancientvoid other"]);
  const sha = await commit(other, message, `${message}.txt`);
  await execFileAsync("git", ["-C", other, "push", "-q", "origin", "main"]);
  await rm(other, { recursive: true, force: true });
  return sha;
}

async function originSha(origin: string, branch = "main"): Promise<string> {
  const { stdout } = await execFileAsync("git", ["--git-dir", origin, "rev-parse", branch]);
  return stdout.trim();
}

const settings = (patch: Partial<MainSyncSettings> = {}): MainSyncSettings => ({ ...MAIN_SYNC_DEFAULTS, ...patch, onlyWhenIdle: true });

describe("EPIC-P67 T67.2 — Stufe 1: Basis neuer Worktrees (ADR-0088)", () => {
  let base: string;
  let out: string;

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), "ancientvoid-p67-"));
    out = await mkdtemp(join(tmpdir(), "ancientvoid-p67-wt-"));
  });

  afterAll(async () => {
    await rm(base, { recursive: true, force: true });
    await rm(out, { recursive: true, force: true });
  });

  it("AC-P67-1 — veralteter Checkout: die Session startet auf origin/main, nicht auf dem lokalen HEAD", async () => {
    const { repo, origin } = await mkProject(base, "fresh");
    const advanced = await advanceOrigin(origin, base, "fresh", "neuer-stand");
    const wt = new WorktreeManager(join(out, "fresh"));
    const result = await wt.create("session-fresh", repo, { mainSync: settings() });
    expect(result).not.toBeNull();
    expect(result!.base).toEqual({ source: "origin", branch: "main" });
    expect(result!.baseSha).toBe(advanced);
    expect(result!.baseSha).not.toBe(await (async () => (await execFileAsync("git", ["-C", repo, "rev-parse", "HEAD"])).stdout.trim())());
    // die Datei des nachgeschobenen Commits ist im Worktree sichtbar
    const { stdout: file } = await execFileAsync("git", ["-C", result!.path, "show", "HEAD:neuer-stand.txt"]);
    expect(file.trim()).toBe("neuer-stand");
  });

  it("AC-P67-2 — Remote nicht erreichbar: Session startet trotzdem auf lokalem HEAD, Grund genannt (K10)", async () => {
    const { repo } = await mkProject(base, "offline");
    await execFileAsync("git", ["-C", repo, "remote", "set-url", "origin", join(base, "gibt-es-nicht.git")]);
    const localHead = (await execFileAsync("git", ["-C", repo, "rev-parse", "HEAD"])).stdout.trim();
    const wt = new WorktreeManager(join(out, "offline"));
    const result = await wt.create("session-offline", repo, { mainSync: settings() });
    expect(result).not.toBeNull();
    expect(result!.base).toMatchObject({ source: "local", reason: "fetch-failed" });
    expect(result!.baseSha).toBe(localHead);
    expect((result!.base as { detail?: string }).detail).toBeTruthy();
  });

  it("AC-P67-2 — Timeout: der Fetch wird hart abgebrochen und als timeout klassifiziert, nie blockiert er den Start", async () => {
    const { repo } = await mkProject(base, "hang");
    // nicht routbare Adresse: TCP hängt → execFile-Timeout (SIGKILL) beendet den Fetch
    await execFileAsync("git", ["-C", repo, "remote", "set-url", "origin", "ssh://git@10.255.255.1/team/proj.git"]);
    const localHead = (await execFileAsync("git", ["-C", repo, "rev-parse", "HEAD"])).stdout.trim();
    const wt = new WorktreeManager(join(out, "hang"));
    const started = Date.now();
    const result = await wt.create("session-hang", repo, { mainSync: settings({ fetchTimeoutSec: 2 }) });
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(result!.base).toEqual({ source: "local", reason: "fetch-failed", fetchReason: "timeout", detail: expect.any(String) });
    expect(result!.baseSha).toBe(localHead);
  }, 20_000);

  it("AC-P67-3 — Feature-Branch ausgecheckt: Basis bleibt der lokale Stand, Grund ist not-main-branch", async () => {
    const { repo, origin } = await mkProject(base, "feature");
    await advanceOrigin(origin, base, "feature", "main-läuft-weiter");
    await execFileAsync("git", ["-C", repo, "checkout", "-q", "-b", "feature/ding"]);
    const featureHead = await commit(repo, "feature-arbeit", "feature.txt");
    const wt = new WorktreeManager(join(out, "feature"));
    const result = await wt.create("session-feature", repo, { mainSync: settings() });
    expect(result!.base).toEqual({ source: "local", reason: "not-main-branch", detail: expect.stringContaining("feature/ding") });
    expect(result!.baseSha).toBe(featureHead);
  });

  it("startSync: off — kein Fetch-Versuch (kaputtes Remote blieb folgenlos), Grund ist off", async () => {
    const { repo } = await mkProject(base, "off");
    await execFileAsync("git", ["-C", repo, "remote", "set-url", "origin", join(base, "gibt-es-nicht.git")]);
    const localHead = (await execFileAsync("git", ["-C", repo, "rev-parse", "HEAD"])).stdout.trim();
    const wt = new WorktreeManager(join(out, "off"));
    const result = await wt.create("session-off", repo, { mainSync: settings({ startSync: "off" }) });
    expect(result!.base).toEqual({ source: "local", reason: "off" });
    expect(result!.baseSha).toBe(localHead);
  });

  it("ohne mainSync-Opt gilt exakt das Vor-P67-Verhalten: lokaler HEAD, keine Angabe", async () => {
    const { repo, origin } = await mkProject(base, "legacy");
    await advanceOrigin(origin, base, "legacy", "neuer-stand");
    const localHead = (await execFileAsync("git", ["-C", repo, "rev-parse", "HEAD"])).stdout.trim();
    const wt = new WorktreeManager(join(out, "legacy"));
    const result = await wt.create("session-legacy", repo);
    expect(result!.base).toEqual({ source: "local", reason: "off" });
    expect(result!.baseSha).toBe(localHead);
  });

  it("kein Remote origin: Grund ist no-remote (EPIC-P67 §3.2 Fehlerpfad)", async () => {
    const { repo } = await mkProject(base, "noremote");
    await execFileAsync("git", ["-C", repo, "remote", "remove", "origin"]);
    const localHead = (await execFileAsync("git", ["-C", repo, "rev-parse", "HEAD"])).stdout.trim();
    const wt = new WorktreeManager(join(out, "noremote"));
    const result = await wt.create("session-noremote", repo, { mainSync: settings() });
    expect(result!.base).toEqual({ source: "local", reason: "no-remote", detail: expect.any(String) });
    expect(result!.baseSha).toBe(localHead);
  });

  it("origin/HEAD zeigt auf einen anderen Hauptbranch (trunk) — die Basis folgt origin/HEAD", async () => {
    const origin = join(base, "headref-origin.git");
    await execFileAsync("git", ["init", "-q", "--bare", "-b", "trunk", origin]);
    const repo = join(base, "headref-repo");
    await execFileAsync("git", ["init", "-q", "-b", "main", repo]);
    await execFileAsync("git", ["-C", repo, "config", "user.email", "test@ancientvoid.local"]);
    await execFileAsync("git", ["-C", repo, "config", "user.name", "ancientvoid test"]);
    await execFileAsync("git", ["-C", repo, "remote", "add", "origin", origin]);
    await commit(repo, "initial", "a.txt");
    // Projekt arbeitet auf "trunk" (Hauptbranch), Remote-Tracking + origin/HEAD wie nach einem Clone
    await execFileAsync("git", ["-C", repo, "push", "-q", "origin", "main:refs/heads/trunk"]);
    await execFileAsync("git", ["-C", repo, "fetch", "-q", "origin", "+refs/heads/trunk:refs/remotes/origin/trunk"]);
    await execFileAsync("git", ["-C", repo, "branch", "-q", "-m", "main", "trunk"]);
    await execFileAsync("git", ["-C", repo, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/trunk"]);
    const advanced = await advanceOriginTrunk(origin, base, "headref");
    const wt = new WorktreeManager(join(out, "headref"));
    const result = await wt.create("session-headref", repo, { mainSync: settings() });
    expect(result!.base).toEqual({ source: "origin", branch: "trunk" });
    expect(result!.baseSha).toBe(advanced);
  });

  it("defaultBranch-Override (release) schlägt origin/HEAD — die Basis ist origin/release", async () => {
    const { repo, origin } = await mkProject(base, "override");
    const other = join(base, "override-release");
    await execFileAsync("git", ["clone", "-q", origin, other]);
    await execFileAsync("git", ["-C", other, "config", "user.email", "other@ancientvoid.local"]);
    await execFileAsync("git", ["-C", other, "config", "user.name", "ancientvoid other"]);
    await execFileAsync("git", ["-C", other, "checkout", "-q", "-b", "release"]);
    await commit(other, "release-stand", "release.txt");
    await execFileAsync("git", ["-C", other, "push", "-q", "origin", "release"]);
    await rm(other, { recursive: true, force: true });
    const releaseSha = await originSha(origin, "release");
    // das Projekt steht selbst auf release (Hauptbranch-Regel), origin/HEAD zeigt weiter auf main
    await execFileAsync("git", ["-C", repo, "fetch", "-q", "origin", "+refs/heads/release:refs/remotes/origin/release"]);
    await execFileAsync("git", ["-C", repo, "checkout", "-q", "-b", "release", "refs/remotes/origin/release"]);
    const wt = new WorktreeManager(join(out, "override"));
    const result = await wt.create("session-override", repo, { mainSync: settings({ defaultBranch: "release" }) });
    expect(result!.base).toEqual({ source: "origin", branch: "release" });
    expect(result!.baseSha).toBe(releaseSha);
  });
});

async function advanceOriginTrunk(origin: string, base: string, name: string): Promise<string> {
  const other = join(base, `${name}-other`);
  await execFileAsync("git", ["clone", "-q", origin, other]);
  await execFileAsync("git", ["-C", other, "config", "user.email", "other@ancientvoid.local"]);
  await execFileAsync("git", ["-C", other, "config", "user.name", "ancientvoid other"]);
  const sha = await commit(other, "trunk-geht-weiter", "trunk.txt");
  await execFileAsync("git", ["-C", other, "push", "-q", "origin", "trunk"]);
  await rm(other, { recursive: true, force: true });
  return sha;
}

function idleAdapter(): Adapter {
  return {
    id: "idle",
    version: "0.0.1",
    capabilities: () => ({ reasoning: false, tools: false, cost: false, steer: true, usage: false, nativeDiscovery: "none", nativeResume: "none", features: basicFeatures({ followUp: true, interrupt: true }) }),
    async start(_spec, ctx) {
      await ctx.spawnWorker(["sh", "-c", "true"]);
      return { sessionId: ctx.sessionId };
    },
    async steer() {
      return { ok: true };
    },
    async status() {
      return { state: "healthy" as const };
    },
    async stop() {},
  };
}

describe("EPIC-P67 T67.2 — Stufe 1 im SessionManager (Events, worktreeSha, K7)", () => {
  let base: string;
  let out: string;

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), "ancientvoid-p67-sm-"));
    out = await mkdtemp(join(tmpdir(), "ancientvoid-p67-sm-wt-"));
  });

  afterAll(async () => {
    await rm(base, { recursive: true, force: true });
    await rm(out, { recursive: true, force: true });
  });

  async function setupManager(repo: string, mainSync: MainSyncSettings | null) {
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    registry.register("idle", idleAdapter);
    const worktrees = new WorktreeManager(join(out, `sm-${Math.random().toString(36).slice(2, 8)}`));
    const manager = new SessionManager(
      db,
      new EventStore(out),
      registry,
      new ProcessRunner(),
      undefined,
      worktrees,
      undefined,
      null,
      [],
      {},
      undefined,
      null,
      mainSync === null ? undefined : () => mainSync,
    );
    return { manager, cleanup: () => manager.shutdown() };
  }

  it("record.worktreeSha ist die origin-Basis (nicht der lokale HEAD); kein Fehlerevent", async () => {
    const { repo, origin } = await mkProject(base, "sm-fresh");
    const advanced = await advanceOrigin(origin, base, "sm-fresh", "neuer-stand");
    const { manager, cleanup } = await setupManager(repo, settings());
    try {
      const record = await manager.create({ adapter: "idle", project: repo, prompt: "arbeite" }, "pc");
      const deadline = Date.now() + 8000;
      while (manager.get(record.id)?.status !== "idle" && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
      const fresh = manager.get(record.id);
      expect(fresh?.worktreeSha).toBe(advanced);
      const events = await manager.tail(record.id, 0);
      const kinds = events.map((e) => (e.payload as { kind?: string }).kind);
      expect(kinds).not.toContain("workspace.main_sync_failed");
      expect(kinds).not.toContain("workspace.main_sync_skipped");
    } finally {
      await cleanup();
    }
  });

  it("Feature-Branch: worktreeSha bleibt der lokale Stand, main_sync_skipped nennt den Grund (AC-P67-3)", async () => {
    const { repo, origin } = await mkProject(base, "sm-feature");
    await advanceOrigin(origin, base, "sm-feature", "main-läuft-weiter");
    await execFileAsync("git", ["-C", repo, "checkout", "-q", "-b", "feature/ding"]);
    const featureHead = await commit(repo, "feature-arbeit", "feature.txt");
    const { manager, cleanup } = await setupManager(repo, settings());
    try {
      const record = await manager.create({ adapter: "idle", project: repo, prompt: "arbeite" }, "pc");
      const deadline = Date.now() + 8000;
      while (manager.get(record.id)?.status !== "idle" && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
      expect(manager.get(record.id)?.worktreeSha).toBe(featureHead);
      const events = await manager.tail(record.id, 0);
      const skipped = events.find((e) => (e.payload as { kind?: string }).kind === "workspace.main_sync_skipped");
      expect(skipped?.payload).toMatchObject({ kind: "workspace.main_sync_skipped", reason: "not-main-branch", detail: expect.stringContaining("feature/ding") });
    } finally {
      await cleanup();
    }
  });

  it("Offline: Session startet auf lokalem HEAD, main_sync_failed mit Grund (AC-P67-2, Regel 6)", async () => {
    const { repo } = await mkProject(base, "sm-offline");
    await execFileAsync("git", ["-C", repo, "remote", "set-url", "origin", join(base, "gibt-es-nicht.git")]);
    const localHead = (await execFileAsync("git", ["-C", repo, "rev-parse", "HEAD"])).stdout.trim();
    const { manager, cleanup } = await setupManager(repo, settings());
    try {
      const record = await manager.create({ adapter: "idle", project: repo, prompt: "arbeite" }, "pc");
      const deadline = Date.now() + 8000;
      while (manager.get(record.id)?.status !== "idle" && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
      expect(manager.get(record.id)?.worktreeSha).toBe(localHead);
      const events = await manager.tail(record.id, 0);
      const failed = events.find((e) => (e.payload as { kind?: string }).kind === "workspace.main_sync_failed");
      expect(failed?.payload).toMatchObject({ kind: "workspace.main_sync_failed", reason: expect.stringMatching(/offline|unknown/) });
    } finally {
      await cleanup();
    }
  });
});
