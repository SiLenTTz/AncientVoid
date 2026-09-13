import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
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
