import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TmuxRunner, TMUX_PREFIX } from "../src/tmux.ts";

const hasTmux = (await new TmuxRunner(join(tmpdir(), "probe")).isAvailable()).valueOf();
const itTmux = hasTmux ? it : it.skip;

describe("TmuxRunner", () => {
  let dir: string;
  let runner: TmuxRunner;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "uacc-tmux-"));
    runner = new TmuxRunner(join(dir, "logs"));
  });
  afterAll(async () => {
    await runner.reapOrphans([]).catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  });

  // C-1 (red-team review, 2026-09-18, T4.10): an unvalidated env KEY was
  // interpolated straight into a shell command string. Runs without
  // itTmux — spawn() now rejects before ever touching tmux, so this must
  // hold even on a machine without tmux installed.
  it("rejects a shell-metacharacter env key instead of building an injectable command (C-1 fix)", async () => {
    const sentinel = join(dir, "pwned");
    await expect(
      runner.spawn({
        name: "test-injection",
        cwd: dir,
        cmd: ["true"],
        env: { [`X=$(touch ${sentinel})`]: "y" },
      }),
    ).rejects.toThrow(/invalid environment variable name/);
    await expect(stat(sentinel)).rejects.toThrow(); // never created — proves the command substitution never ran
  });

  it("accepts a legal env var name and rejects other illegal shapes without touching tmux", async () => {
    await expect(runner.spawn({ name: "t", cwd: dir, cmd: ["true"], env: { "1BAD": "y" } })).rejects.toThrow(
      /invalid environment variable name/,
    );
    await expect(runner.spawn({ name: "t", cwd: dir, cmd: ["true"], env: { "BAD KEY": "y" } })).rejects.toThrow(
      /invalid environment variable name/,
    );
  });

  itTmux("passes a legal env var through to the real spawned process", async () => {
    const proc = await runner.spawn({
      name: "test-env",
      cwd: dir,
      cmd: ["bash", "-c", "echo $GREETING"],
      env: { GREETING: "hello world" },
    });
    const lines: string[] = [];
    proc.onStdout((chunk) => {
      for (const l of chunk.split("\n")) if (l.trim()) lines.push(l.trim());
    });
    await proc.exited();
    await new Promise((r) => setTimeout(r, 600));
    expect(lines).toEqual(["hello world"]);
  });

  itTmux("preserves a single quote in an env value instead of silently deleting it (value-quoting fix)", async () => {
    const proc = await runner.spawn({
      name: "test-env-quote",
      cwd: dir,
      cmd: ["bash", "-c", "echo $MSG"],
      env: { MSG: "it's a test" },
    });
    const lines: string[] = [];
    proc.onStdout((chunk) => {
      for (const l of chunk.split("\n")) if (l.trim()) lines.push(l.trim());
    });
    await proc.exited();
    await new Promise((r) => setTimeout(r, 600));
    expect(lines).toEqual(["it's a test"]);
  });

  itTmux("spawns a command and streams stdout lines", async () => {
    const proc = await runner.spawn({
      name: "test-stdout",
      cwd: dir,
      cmd: ["bash", "-c", "for i in 1 2 3; do echo line-$i; done; sleep 0.2"],
    });
    const lines: string[] = [];
    proc.onStdout((chunk) => {
      for (const l of chunk.split("\n")) if (l.trim()) lines.push(l.trim());
    });
    const exit = await proc.exited();
    expect(exit.code).toBe(0);
    // pipe-pane flush needs a beat
    await new Promise((r) => setTimeout(r, 600));
    expect(lines).toEqual(["line-1", "line-2", "line-3"]);
  });

  itTmux("reports exit codes via marker", async () => {
    const proc = await runner.spawn({
      name: "test-exit",
      cwd: dir,
      cmd: ["bash", "-c", "exit 7"],
    });
    const { code } = await proc.exited();
    expect(code).toBe(7);
  });

  itTmux("lists only uacc-prefixed workers and reaps orphans", async () => {
    await runner.spawn({
      name: "test-orphan",
      cwd: dir,
      cmd: ["bash", "-c", "sleep 30"],
    });
    const workers = await runner.list();
    expect(workers.some((w) => w.name === "test-orphan")).toBe(true);
    const reaped = await runner.reapOrphans(["test-orphan"]);
    expect(reaped).toEqual([]);
    const reaped2 = await runner.reapOrphans([]);
    expect(reaped2).toContain(`${TMUX_PREFIX}test-orphan`);
  });

  itTmux("BUG-0019: never reaps a worker another hub owns", async () => {
    const otherDir = await mkdtemp(join(tmpdir(), "uacc-tmux-other-"));
    const other = new TmuxRunner(join(otherDir, "logs"));
    try {
      await other.spawn({ name: "test-foreign", cwd: otherDir, cmd: ["bash", "-c", "sleep 30"] });
      expect((await runner.list()).some((w) => w.name === "test-foreign")).toBe(false);
      const reaped = await runner.reapOrphans([]);
      expect(reaped).not.toContain(`${TMUX_PREFIX}test-foreign`);
      expect((await other.list()).some((w) => w.name === "test-foreign")).toBe(true);
    } finally {
      await other.reapOrphans([]).catch(() => undefined);
      await rm(otherDir, { recursive: true, force: true });
    }
  });

  itTmux("T5.6: a restarted hub adopts a surviving worker and reads on where it stopped", async () => {
    const first = await runner.spawn({
      name: "test-adopt",
      cwd: dir,
      cmd: ["bash", "-c", "echo eins; sleep 0.6; echo zwei; sleep 0.3; exit 4"],
    });
    const before: string[] = [];
    first.onStdout((chunk) => before.push(chunk.trim()));
    const deadline = Date.now() + 3000;
    while (!before.includes("eins") && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    expect(before).toEqual(["eins"]);

    // Same log dir → same owner, like the same hub after kill -9.
    const restarted = new TmuxRunner(join(dir, "logs"));
    const adopted = await restarted.adopt("test-adopt");
    expect(adopted).not.toBeNull();
    const after: string[] = [];
    adopted!.onStdout((chunk) => after.push(chunk.trim()));
    const { code } = await adopted!.exited();
    expect(after).toEqual(["zwei"]);
    expect(code).toBe(4);
    expect(await restarted.adopt("gibt-es-nicht")).toBeNull();
  });

  itTmux("kill terminates a worker", async () => {
    const proc = await runner.spawn({
      name: "test-kill",
      cwd: dir,
      cmd: ["bash", "-c", "sleep 30"],
    });
    await proc.kill("SIGKILL");
    const { code } = await proc.exited();
    expect(code === null || code !== 0).toBe(true);
    const workers = await runner.list();
    expect(workers.some((w) => w.name === "test-kill")).toBe(false);
  });
});
