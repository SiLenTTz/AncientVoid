import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendOptimizerFeedback, readOptimizerFeedback } from "../../../src/modules/prompts/optimizer-feedback.ts";

describe("prompt-optimizer feedback storage (T3.9 Learning-Loop) — real file I/O, no mocking", () => {
  let dir: string;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("appends entries as real JSONL, readable back byte-for-byte", async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-optfb-"));
    await appendOptimizerFeedback(dir, {
      adapter: "claude",
      project: "/tmp/repo",
      original: "mach das mit dem login besser",
      enhanced: "Ziel: ...\nScope: ...",
      decision: "accepted",
      costUsd: 0.0654,
      latencyMs: 6617,
    });
    await appendOptimizerFeedback(dir, {
      adapter: "claude",
      project: "/tmp/repo",
      original: "fix the bug",
      enhanced: "Ziel: den Bug fixen\nScope: ...",
      decision: "rejected",
      latencyMs: 4200,
    });

    const raw = await readFile(join(dir, "prompt-optimizer-feedback.jsonl"), "utf8");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(2);
    // Real JSONL — each line parses independently.
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();

    const entries = await readOptimizerFeedback(dir);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.decision).toBe("accepted");
    expect(entries[0]!.costUsd).toBe(0.0654);
    expect(entries[1]!.decision).toBe("rejected");
    expect(entries[1]!.costUsd).toBeUndefined(); // never guessed — codex-shaped adapters have no cost figure
    expect(typeof entries[0]!.ts).toBe("string");
  });

  it("readOptimizerFeedback returns an empty array, not an error, when nothing was ever recorded", async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-optfb-empty-"));
    const entries = await readOptimizerFeedback(dir);
    expect(entries).toEqual([]);
  });

  it("creates the data directory if it doesn't exist yet (a fresh hub's first optimizer decision)", async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-optfb-fresh-"));
    const nested = join(dir, "nested", "data");
    await appendOptimizerFeedback(nested, {
      adapter: "claude",
      project: "/tmp",
      original: "x",
      enhanced: "y",
      decision: "accepted",
      latencyMs: 100,
    });
    const entries = await readOptimizerFeedback(nested);
    expect(entries).toHaveLength(1);
  });
});
