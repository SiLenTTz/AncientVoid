import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeRecordingContext, waitFor } from "@uacc/adapter-testkit";
import { createAdapter } from "../src/index.ts";
import { sanitizeCwdToProjectDirName } from "../src/workspace.ts";

// Real ~/.claude layout is reproduced exactly (see workspace.ts's own doc
// comment for the real, verified sanitization rule and directory shape) —
// this test builds a real `<claudeDir>/projects/<sanitized-cwd>/<id>.jsonl`
// tree and drives the adapter against it end-to-end, including a real
// writer appending new lines mid-poll to prove the live-tail behavior.

function line(obj: unknown): string {
  return JSON.stringify(obj) + "\n";
}

function userLine(text: string) {
  return line({ type: "user", message: { role: "user", content: text } });
}

function assistantLine(text: string) {
  return line({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } });
}

interface Fixture {
  dir: string;
  claudeDir: string;
  projectPath: string;
  projectDir: string;
}

function makeFixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "claude-clip-test-"));
  const claudeDir = join(dir, "dot-claude");
  const projectPath = join(dir, "my-project");
  mkdirSync(projectPath, { recursive: true });
  const projectDir = join(claudeDir, "projects", sanitizeCwdToProjectDirName(projectPath));
  mkdirSync(projectDir, { recursive: true });
  return { dir, claudeDir, projectPath, projectDir };
}

let activeFixture: Fixture | undefined;
afterEach(() => {
  if (activeFixture) rmSync(activeFixture.dir, { recursive: true, force: true });
  activeFixture = undefined;
});

describe("claude-clip adapter — real transcript layout, real live-tail behavior", () => {
  it("identity + capabilities are honest (read-only: steer:false, no cost/usage record in this format)", () => {
    const adapter = createAdapter();
    expect(adapter.id).toBe("claude-clip");
    expect(adapter.capabilities()).toEqual({ reasoning: true, tools: true, cost: false, steer: false, usage: false, nativeDiscovery: "read-only", nativeResume: "none" });
  });

  it("start() finds the most recent transcript for spec.project, seeds it, and follows new lines live", async () => {
    const fx = makeFixture();
    activeFixture = fx;
    const filePath = join(fx.projectDir, "11111111-1111-1111-1111-111111111111.jsonl");
    writeFileSync(filePath, userLine("hello") + assistantLine("hi there"));

    const controller = new AbortController();
    const ctx = makeRecordingContext({ signal: controller.signal });
    const adapter = createAdapter({ claudeDir: fx.claudeDir, pollIntervalMs: 30, seedLines: 10 });
    await adapter.start({ adapter: "claude-clip", project: fx.projectPath }, ctx);

    await waitFor(() => ctx.events.some((e) => e.summary === "hi there"));
    expect(ctx.events.some((e) => e.summary === "hello")).toBe(true);

    // Real Claude Code process keeps appending to the same file mid-poll —
    // the running adapter must pick up the new line without a restart.
    appendFileSync(filePath, assistantLine("live update"));
    await waitFor(() => ctx.events.some((e) => e.summary === "live update"));
    expect((await adapter.status({ sessionId: ctx.sessionId })).state).toBe("healthy");
    controller.abort();
  });

  it("a partial (not-yet-newline-terminated) write is not parsed until it completes", async () => {
    const fx = makeFixture();
    activeFixture = fx;
    const filePath = join(fx.projectDir, "22222222-2222-2222-2222-222222222222.jsonl");
    writeFileSync(filePath, "");

    const controller = new AbortController();
    const ctx = makeRecordingContext({ signal: controller.signal });
    const adapter = createAdapter({ claudeDir: fx.claudeDir, pollIntervalMs: 25, seedLines: 10 });
    await adapter.start({ adapter: "claude-clip", project: fx.projectPath }, ctx);

    const full = assistantLine("complete message");
    // Simulate a writer mid-flush: append everything but the trailing newline first.
    appendFileSync(filePath, full.slice(0, -1));
    await new Promise((r) => setTimeout(r, 80));
    expect(ctx.events.some((e) => e.summary === "complete message")).toBe(false);

    appendFileSync(filePath, "\n");
    await waitFor(() => ctx.events.some((e) => e.summary === "complete message"));
    controller.abort();
  });

  it("seedLines bounds the initial backfill instead of replaying the full transcript", async () => {
    const fx = makeFixture();
    activeFixture = fx;
    const filePath = join(fx.projectDir, "33333333-3333-3333-3333-333333333333.jsonl");
    let content = "";
    for (let i = 0; i < 20; i++) content += assistantLine(`message ${i}`);
    writeFileSync(filePath, content);

    const controller = new AbortController();
    const ctx = makeRecordingContext({ signal: controller.signal });
    const adapter = createAdapter({ claudeDir: fx.claudeDir, pollIntervalMs: 200, seedLines: 3 });
    await adapter.start({ adapter: "claude-clip", project: fx.projectPath }, ctx);
    await new Promise((r) => setTimeout(r, 50));

    expect(ctx.events.some((e) => e.summary === "message 19")).toBe(true);
    expect(ctx.events.some((e) => e.summary === "message 17")).toBe(true);
    expect(ctx.events.some((e) => e.summary === "message 16")).toBe(false);
    controller.abort();
  });

  it("args.sessionId picks a specific transcript instead of the most recently modified one", async () => {
    const fx = makeFixture();
    activeFixture = fx;
    const olderPath = join(fx.projectDir, "aaaaaaaa-0000-0000-0000-000000000000.jsonl");
    const targetPath = join(fx.projectDir, "bbbbbbbb-0000-0000-0000-000000000000.jsonl");
    writeFileSync(olderPath, assistantLine("wrong session"));
    writeFileSync(targetPath, assistantLine("right session"));
    // Make the non-target file the most recently modified one, to prove
    // args.sessionId really overrides "most recent" rather than agreeing
    // with it by coincidence.
    const future = new Date(Date.now() + 60_000);
    utimesSync(olderPath, future, future);

    const controller = new AbortController();
    const ctx = makeRecordingContext({ signal: controller.signal });
    const adapter = createAdapter({ claudeDir: fx.claudeDir, pollIntervalMs: 200, seedLines: 10 });
    await adapter.start(
      { adapter: "claude-clip", project: fx.projectPath, args: { sessionId: "bbbbbbbb-0000-0000-0000-000000000000" } },
      ctx,
    );
    await new Promise((r) => setTimeout(r, 50));

    expect(ctx.events.some((e) => e.summary === "right session")).toBe(true);
    expect(ctx.events.some((e) => e.summary === "wrong session")).toBe(false);
    controller.abort();
  });

  it("steer park stops polling, steer resume restarts it", async () => {
    const fx = makeFixture();
    activeFixture = fx;
    const filePath = join(fx.projectDir, "44444444-4444-4444-4444-444444444444.jsonl");
    writeFileSync(filePath, assistantLine("message 0"));

    const controller = new AbortController();
    const ctx = makeRecordingContext({ signal: controller.signal });
    const adapter = createAdapter({ claudeDir: fx.claudeDir, pollIntervalMs: 25, seedLines: 10 });
    const handle = await adapter.start({ adapter: "claude-clip", project: fx.projectPath }, ctx);
    await waitFor(() => ctx.events.some((e) => e.summary === "message 0"));

    await adapter.steer(handle, { kind: "park" }, ctx);
    const countAfterPark = ctx.events.length;
    appendFileSync(filePath, assistantLine("message during park"));
    await new Promise((r) => setTimeout(r, 100));
    expect(ctx.events.length).toBe(countAfterPark);

    await adapter.steer(handle, { kind: "resume" }, ctx);
    await waitFor(() => ctx.events.some((e) => e.summary === "message during park"));
    controller.abort();
  });

  it("start() throws when no ~/.claude/projects directory exists for spec.project", async () => {
    const fx = makeFixture();
    activeFixture = fx;
    const ctx = makeRecordingContext();
    const adapter = createAdapter({ claudeDir: fx.claudeDir });
    await expect(adapter.start({ adapter: "claude-clip", project: "/nowhere/matching" }, ctx)).rejects.toThrow(
      /no ~\/\.claude\/projects directory/,
    );
  });

  it("start() throws when the project directory exists but has no transcripts yet", async () => {
    const fx = makeFixture();
    activeFixture = fx;
    const ctx = makeRecordingContext();
    const adapter = createAdapter({ claudeDir: fx.claudeDir });
    await expect(adapter.start({ adapter: "claude-clip", project: fx.projectPath }, ctx)).rejects.toThrow(/no session transcripts/);
  });

  it("stop() tears down the poller — no further events after stop even if the transcript keeps growing", async () => {
    const fx = makeFixture();
    activeFixture = fx;
    const filePath = join(fx.projectDir, "55555555-5555-5555-5555-555555555555.jsonl");
    writeFileSync(filePath, assistantLine("message 0"));

    const ctx = makeRecordingContext();
    const adapter = createAdapter({ claudeDir: fx.claudeDir, pollIntervalMs: 25, seedLines: 10 });
    const handle = await adapter.start({ adapter: "claude-clip", project: fx.projectPath }, ctx);
    await waitFor(() => ctx.events.some((e) => e.summary === "message 0"));

    await adapter.stop(handle, ctx);
    const countAfterStop = ctx.events.length;
    appendFileSync(filePath, assistantLine("should never appear"));
    await new Promise((r) => setTimeout(r, 80));
    expect(ctx.events.length).toBe(countAfterStop);
    expect((await adapter.status(handle)).state).toBe("down");
  });
});
