import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkerProcess } from "@uacc/contracts";
import { makeRecordingContext, waitFor } from "@uacc/adapter-testkit";
import { createAdapter } from "../src/index.ts";

/**
 * 2026-10-26: same testkit gap as hermes — runContractTests() cannot
 * simulate spawnWorker, so these lifecycle tests use makeRecordingContext
 * and capture the argv the adapter really builds. The live contract is in
 * src/index.ts's doc comment (evox2 + zeratul, 2026-10-25): model choice
 * via `--model provider/id`, headless without a tty.
 */

function fakeProcess(): WorkerProcess {
  const exitCbs = new Set<(code: number | null) => void>();
  setTimeout(() => {
    for (const cb of exitCbs) cb(0);
  }, 0);
  return {
    onStdout: () => undefined,
    onStderr: () => undefined,
    onExit: (cb) => exitCbs.add(cb),
    write: () => undefined,
    kill: async () => undefined,
    exited: () => new Promise((resolve) => exitCbs.add((code) => resolve({ code }))),
  };
}

function recording() {
  const spawned: string[][] = [];
  const ctx = makeRecordingContext({
    spawnWorker: async (cmd) => {
      spawned.push(cmd);
      return fakeProcess();
    },
  });
  return { ctx, spawned };
}

const EVOX2 = "evo-evox2/halogen-qwen3.8-flash-next-uncensored-iq4xs";

describe("pi adapter model handling", () => {
  it("startet mit dem konfigurierten Default-Modell und meldet es als Event", async () => {
    const adapter = createAdapter({ model: EVOX2 });
    const { ctx, spawned } = recording();
    await adapter.start({ adapter: "pi", project: process.cwd(), prompt: "hallo" }, ctx);
    await waitFor(() => ctx.events.some((e) => (e.payload as { kind?: string }).kind === "pi.turn_end"));
    expect(spawned[0]!.join(" ")).toContain(`--model ${EVOX2}`);
    const modelEvent = ctx.events.find((e) => (e.payload as { kind?: string }).kind === "pi.model");
    expect(modelEvent?.payload).toMatchObject({ kind: "pi.model", model: EVOX2 });
  });

  it("das Modell der Session gewinnt über den Default", async () => {
    const adapter = createAdapter({ model: EVOX2 });
    const { ctx, spawned } = recording();
    await adapter.start({ adapter: "pi", project: process.cwd(), prompt: "x", model: "other/mini" }, ctx);
    await waitFor(() => ctx.events.some((e) => (e.payload as { kind?: string }).kind === "pi.turn_end"));
    expect(spawned[0]!.join(" ")).toContain("--model other/mini");
    expect(spawned[0]!.join(" ")).not.toContain(EVOX2);
  });

  it("ohne Modell: kein --model und kein Model-Event (ehrlich, nicht geraten)", async () => {
    const adapter = createAdapter({});
    const { ctx, spawned } = recording();
    await adapter.start({ adapter: "pi", project: process.cwd(), prompt: "x" }, ctx);
    await waitFor(() => ctx.events.some((e) => (e.payload as { kind?: string }).kind === "pi.turn_end"));
    expect(spawned[0]!.join(" ")).not.toContain("--model");
    expect(ctx.events.some((e) => (e.payload as { kind?: string }).kind === "pi.model")).toBe(false);
  });

  it("steer nutzt dasselbe effektive Modell weiter", async () => {
    const adapter = createAdapter({ model: EVOX2 });
    const { ctx, spawned } = recording();
    const handle = await adapter.start({ adapter: "pi", project: process.cwd(), prompt: "a" }, ctx);
    await waitFor(() => ctx.events.some((e) => (e.payload as { kind?: string }).kind === "pi.turn_end"));
    const ack = await adapter.steer(handle, { kind: "prompt", text: "b" }, ctx);
    expect(ack.ok).toBe(true);
    expect(spawned[1]!.join(" ")).toContain(`--model ${EVOX2}`);
    expect(spawned[1]!.join(" ")).toContain("--continue");
  });
});

describe("pi adapter prompt argv (BUG-0066)", () => {
  // Run the built command line through a real `sh`, with the pi binary
  // replaced by a script that prints its argv — so the test sees exactly
  // what pi would receive, quoting included.
  function argvPi(): string {
    const dir = mkdtempSync(join(tmpdir(), "uacc-pi-argv-"));
    const bin = join(dir, "pi");
    writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" -e 'process.stdout.write(JSON.stringify(process.argv.slice(1)))' -- "$@"\n`);
    chmodSync(bin, 0o755);
    return bin;
  }

  function received(cmd: string[]): string[] {
    return JSON.parse(execFileSync(cmd[0]!, cmd.slice(1), { encoding: "utf8" })) as string[];
  }

  const prompts = ["hallo", 'Sag "OK" und dann \'tschüss\'', "-v ist keine Option", "$HOME `id` ; echo x"];

  it.each(prompts)("pi bekommt den Prompt unverändert als einzige Nachricht: %s", async (prompt) => {
    const adapter = createAdapter({ command: argvPi(), model: EVOX2 });
    const { ctx, spawned } = recording();
    const handle = await adapter.start({ adapter: "pi", project: process.cwd(), prompt }, ctx);
    await adapter.steer(handle, { kind: "prompt", text: prompt }, ctx);
    for (const cmd of spawned) {
      const argv = received(cmd);
      expect(argv).not.toContain("exec");
      // Everything after `--` is a message; exactly one, verbatim.
      expect(argv.slice(argv.indexOf("--") + 1)).toEqual([prompt]);
    }
  });
});
