import { describe, it, expect, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeRecordingContext, waitFor } from "@uacc/adapter-testkit";
import { createAdapter } from "../src/index.ts";
import { SUPPORTED_BUBBLE_VERSION } from "../src/normalize.ts";

// This adapter's "external world" is a real SQLite file, not a CLI stream —
// so unlike the CLI adapters' fixture-replay pattern, this test builds a
// REAL SQLite database with the exact real schema (verified live against
// an actual Cursor installation, see normalize.ts/workspace.ts) and drives
// the adapter against it end-to-end, including a real writer appending new
// rows mid-poll to prove the live-tail behavior actually works.

const CREATE_TABLES = `
  CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);
  CREATE TABLE cursorDiskKV (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);
  CREATE TABLE composerHeaders (composerId TEXT PRIMARY KEY, workspaceId TEXT, createdAt INTEGER, lastUpdatedAt INTEGER, isArchived INTEGER, isSubagent INTEGER, recency INTEGER, checkpointAt INTEGER, value TEXT, subagentTypeName TEXT);
`;

interface Fixture {
  dir: string;
  userDir: string;
  projectDir: string;
  dbPath: string;
  composerId: string;
  writer: DatabaseSync;
}

function bubbleIds(n: number, prefix = "b"): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix}-${String(i).padStart(3, "0")}`);
}

function setComposerData(writer: DatabaseSync, composerId: string, headerIds: string[], extra: Record<string, unknown> = {}): void {
  const data = {
    fullConversationHeadersOnly: headerIds.map((id, i) => ({ bubbleId: id, type: i % 2 === 0 ? 1 : 2, createdAt: "" })),
    status: "completed",
    modelConfig: { modelName: "grok-4.6" },
    contextTokensUsed: 1000,
    contextTokenLimit: 256000,
    usageData: {},
    ...extra,
  };
  writer.prepare("INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)").run(`composerData:${composerId}`, JSON.stringify(data));
}

function setBubble(writer: DatabaseSync, composerId: string, bubbleId: string, type: 1 | 2, text: string): void {
  const bubble = { _v: SUPPORTED_BUBBLE_VERSION, bubbleId, type, text };
  writer.prepare("INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)").run(`bubbleId:${composerId}:${bubbleId}`, JSON.stringify(bubble));
}

function makeFixture(opts?: { omitColumn?: string }): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "cursor-clip-test-"));
  const userDir = join(dir, "cursor-user");
  const projectDir = join(dir, "project");
  mkdirSync(projectDir, { recursive: true });
  const wsHash = "abc123hash";
  const wsDir = join(userDir, "workspaceStorage", wsHash);
  mkdirSync(wsDir, { recursive: true });
  writeFileSync(join(wsDir, "workspace.json"), JSON.stringify({ folder: `file://${projectDir}` }));
  const globalDir = join(userDir, "globalStorage");
  mkdirSync(globalDir, { recursive: true });
  const dbPath = join(globalDir, "state.vscdb");

  const writer = new DatabaseSync(dbPath);
  writer.exec("PRAGMA journal_mode=WAL;");
  if (opts?.omitColumn) {
    const cols = "composerId TEXT PRIMARY KEY, workspaceId TEXT, createdAt INTEGER, lastUpdatedAt INTEGER, isArchived INTEGER, isSubagent INTEGER, recency INTEGER, checkpointAt INTEGER, value TEXT, subagentTypeName TEXT"
      .split(", ")
      .filter((c) => !c.startsWith(opts.omitColumn!))
      .join(", ");
    writer.exec(`
      CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);
      CREATE TABLE cursorDiskKV (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);
      CREATE TABLE composerHeaders (${cols});
    `);
  } else {
    writer.exec(CREATE_TABLES);
  }

  const composerId = "composer-1";
  if (!opts?.omitColumn) {
    writer
      .prepare("INSERT INTO composerHeaders (composerId, workspaceId, createdAt, lastUpdatedAt, isArchived, isSubagent, recency, checkpointAt, value, subagentTypeName) VALUES (?, ?, 0, 0, 0, 0, 0, 0, '{}', NULL)")
      .run(composerId, wsHash);
  }

  return { dir, userDir, projectDir, dbPath, composerId, writer };
}

let activeFixture: Fixture | undefined;
afterEach(() => {
  activeFixture?.writer.close();
  if (activeFixture) rmSync(activeFixture.dir, { recursive: true, force: true });
  activeFixture = undefined;
});

describe("cursor-clip adapter — real SQLite schema, real live-tail behavior", () => {
  it("identity + capabilities are honest (read-only: steer:false)", () => {
    const adapter = createAdapter();
    expect(adapter.id).toBe("cursor-clip");
    expect(adapter.capabilities()).toEqual({ reasoning: true, tools: true, cost: false, steer: false, usage: false, nativeDiscovery: "read-only", nativeResume: "none" });
  });

  it("start() resolves the workspace from spec.project, seeds recent bubbles, and follows new ones live", async () => {
    const fx = makeFixture();
    activeFixture = fx;
    const ids = bubbleIds(3);
    setComposerData(fx.writer, fx.composerId, ids);
    for (let i = 0; i < ids.length; i++) setBubble(fx.writer, fx.composerId, ids[i]!, i % 2 === 0 ? 1 : 2, `message ${i}`);

    const controller = new AbortController();
    const ctx = makeRecordingContext({ signal: controller.signal });
    const adapter = createAdapter({ userDir: fx.userDir, pollIntervalMs: 30, seedBubbles: 10 });
    await adapter.start({ adapter: "cursor-clip", project: fx.projectDir }, ctx);

    await waitFor(() => ctx.events.some((e) => e.summary === "message 2"));
    expect(ctx.events.some((e) => e.summary === "message 0")).toBe(true);

    // Real writer appends a 4th bubble mid-poll — the running adapter must
    // pick it up without a restart.
    const newId = "b-003";
    const headers = [...ids, newId];
    fx.writer.exec(`DELETE FROM cursorDiskKV WHERE key = 'composerData:${fx.composerId}'`);
    setComposerData(fx.writer, fx.composerId, headers);
    setBubble(fx.writer, fx.composerId, newId, 1, "message 3 (live)");

    await waitFor(() => ctx.events.some((e) => e.summary === "message 3 (live)"));
    expect((await adapter.status({ sessionId: ctx.sessionId })).state).toBe("healthy");
    controller.abort();
  });

  it("seedBubbles bounds the initial backfill instead of replaying full history", async () => {
    const fx = makeFixture();
    activeFixture = fx;
    const ids = bubbleIds(20);
    setComposerData(fx.writer, fx.composerId, ids);
    for (let i = 0; i < ids.length; i++) setBubble(fx.writer, fx.composerId, ids[i]!, i % 2 === 0 ? 1 : 2, `message ${i}`);

    const controller = new AbortController();
    const ctx = makeRecordingContext({ signal: controller.signal });
    const adapter = createAdapter({ userDir: fx.userDir, pollIntervalMs: 30, seedBubbles: 3 });
    await adapter.start({ adapter: "cursor-clip", project: fx.projectDir }, ctx);
    await waitFor(() => ctx.events.some((e) => e.summary === "message 19"));

    expect(ctx.events.some((e) => e.summary === "message 17")).toBe(true);
    expect(ctx.events.some((e) => e.summary === "message 16")).toBe(false);
    expect(ctx.events.some((e) => e.summary === "message 5")).toBe(false);
    controller.abort();
  });

  it("steer park stops polling, steer resume restarts it", async () => {
    const fx = makeFixture();
    activeFixture = fx;
    const ids = bubbleIds(1);
    setComposerData(fx.writer, fx.composerId, ids);
    setBubble(fx.writer, fx.composerId, ids[0]!, 1, "message 0");

    const controller = new AbortController();
    const ctx = makeRecordingContext({ signal: controller.signal });
    const adapter = createAdapter({ userDir: fx.userDir, pollIntervalMs: 25, seedBubbles: 10 });
    const handle = await adapter.start({ adapter: "cursor-clip", project: fx.projectDir }, ctx);
    await waitFor(() => ctx.events.some((e) => e.summary === "message 0"));

    await adapter.steer(handle, { kind: "park" }, ctx);
    const countAfterPark = ctx.events.length;
    const newId = "b-parked";
    fx.writer.exec(`DELETE FROM cursorDiskKV WHERE key = 'composerData:${fx.composerId}'`);
    setComposerData(fx.writer, fx.composerId, [...ids, newId]);
    setBubble(fx.writer, fx.composerId, newId, 1, "message during park");
    await new Promise((r) => setTimeout(r, 100));
    expect(ctx.events.length).toBe(countAfterPark);

    await adapter.steer(handle, { kind: "resume" }, ctx);
    await waitFor(() => ctx.events.some((e) => e.summary === "message during park"));
    controller.abort();
  });

  it("a real schema break (missing column) is reported as broken, not misread", async () => {
    const fx = makeFixture({ omitColumn: "isSubagent" });
    activeFixture = fx;
    const controller = new AbortController();
    const ctx = makeRecordingContext({ signal: controller.signal });
    const adapter = createAdapter({ userDir: fx.userDir, pollIntervalMs: 30 });
    const handle = await adapter.start({ adapter: "cursor-clip", project: fx.projectDir }, ctx);
    const report = await adapter.status(handle);
    expect(report.state).toBe("broken");
    expect(report.detail).toContain("isSubagent");
    controller.abort();
  });

  it("start() throws when no Cursor database exists at all (clear misconfiguration, same class as adapter-aider's missing-model refusal)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cursor-clip-nodb-"));
    const ctx = makeRecordingContext();
    const adapter = createAdapter({ userDir: join(dir, "does-not-exist") });
    await expect(adapter.start({ adapter: "cursor-clip", project: dir }, ctx)).rejects.toThrow(/no Cursor state database/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("start() throws when the project has no matching Cursor workspace", async () => {
    const fx = makeFixture();
    activeFixture = fx;
    const ctx = makeRecordingContext();
    const adapter = createAdapter({ userDir: fx.userDir });
    await expect(adapter.start({ adapter: "cursor-clip", project: "/nowhere/matching" }, ctx)).rejects.toThrow(/no Cursor workspace found/);
  });

  it("args.composerId bypasses workspace discovery entirely", async () => {
    const fx = makeFixture();
    activeFixture = fx;
    setComposerData(fx.writer, fx.composerId, bubbleIds(1));
    setBubble(fx.writer, fx.composerId, "b-000", 1, "direct hit");

    const controller = new AbortController();
    const ctx = makeRecordingContext({ signal: controller.signal });
    const adapter = createAdapter({ userDir: fx.userDir, pollIntervalMs: 30 });
    await adapter.start({ adapter: "cursor-clip", project: "/anything/at/all", args: { composerId: fx.composerId } }, ctx);
    await waitFor(() => ctx.events.some((e) => e.summary === "direct hit"));
    controller.abort();
  });

  it("stop() tears down the poller — no further events after stop even if Cursor keeps writing", async () => {
    const fx = makeFixture();
    activeFixture = fx;
    setComposerData(fx.writer, fx.composerId, bubbleIds(1));
    setBubble(fx.writer, fx.composerId, "b-000", 1, "message 0");

    const ctx = makeRecordingContext();
    const adapter = createAdapter({ userDir: fx.userDir, pollIntervalMs: 25 });
    const handle = await adapter.start({ adapter: "cursor-clip", project: fx.projectDir }, ctx);
    await waitFor(() => ctx.events.some((e) => e.summary === "message 0"));

    await adapter.stop(handle, ctx);
    const countAfterStop = ctx.events.length;
    fx.writer.exec(`DELETE FROM cursorDiskKV WHERE key = 'composerData:${fx.composerId}'`);
    setComposerData(fx.writer, fx.composerId, ["b-000", "b-after-stop"]);
    setBubble(fx.writer, fx.composerId, "b-after-stop", 1, "should never appear");
    await new Promise((r) => setTimeout(r, 80));
    expect(ctx.events.length).toBe(countAfterStop);
    expect((await adapter.status(handle)).state).toBe("down");
  });
});
