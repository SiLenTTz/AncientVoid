import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkspaceEventKind, WorkspaceManifest } from "@ancientvoid/contracts";
import { HubDatabase } from "../../../src/platform/db.ts";
import { EventStore } from "../../../src/platform/eventstore.ts";
import { WorkspaceRuntime, foldWorkspaceState, type WorkspaceEmit } from "../../../src/modules/workspace/workspace-runtime.ts";

function collector(): { events: { kind: WorkspaceEventKind; payload: Record<string, unknown> }[]; emit: WorkspaceEmit } {
  const events: { kind: WorkspaceEventKind; payload: Record<string, unknown> }[] = [];
  return { events, emit: async (kind, payload) => void events.push({ kind, payload }) };
}

const manifest = (setup: WorkspaceManifest["setup"]): WorkspaceManifest => ({ schemaVersion: 1, setup });

async function setupRuntime(tag: string): Promise<{ runtime: WorkspaceRuntime; db: HubDatabase; dir: string; worktree: string }> {
  const dir = await mkdtemp(join(tmpdir(), `ancientvoid-p29rt-${tag}-`));
  const worktree = join(dir, "wt");
  await mkdir(worktree, { recursive: true });
  const db = new HubDatabase(":memory:");
  return { runtime: new WorkspaceRuntime(db, new EventStore(dir)), db, dir, worktree };
}

describe("EPIC-P29 T29.3: WorkspaceRuntime (ADR-0051 §3)", () => {
  it("erfolgreiches Setup: preparing → ready, Journal done, kein Fehler-Event", async () => {
    const { runtime, db, dir, worktree } = await setupRuntime("ok");
    try {
      const { events, emit } = collector();
      const result = await runtime.runSetup({
        sessionId: "s1",
        manifest: manifest([{ id: "touch", argv: ["touch", "marker.txt"], timeoutMs: 10_000 }]),
        manifestHash: "abc",
        worktreePath: worktree,
        actor: "jan",
        emit,
      });
      expect(result.ok).toBe(true);
      expect(events.map((e) => e.kind)).toEqual(["workspace.preparing", "workspace.ready"]);
      expect(runtime.listJournal("s1").at(-1)).toMatchObject({ kind: "setup", state: "done" });
      db.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("Schrittfehler: nennt Schritt, Exitcode und Log-Blob; Journal failed mit Schritt", async () => {
    const { runtime, db, dir, worktree } = await setupRuntime("exit");
    try {
      const { events, emit } = collector();
      const result = await runtime.runSetup({
        sessionId: "s2",
        manifest: manifest([{ id: "boom", argv: ["sh", "-c", "echo schief >&2; exit 3"], timeoutMs: 10_000 }]),
        manifestHash: "abc",
        worktreePath: worktree,
        actor: null,
        emit,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure).toMatchObject({ step: "boom", kind: "exit", exitCode: 3 });
        expect(result.failure.logBlobRef).toMatch(/^sha256:/);
        expect(result.failure.detail).toContain("schief");
      }
      expect(events.find((e) => e.kind === "workspace.failed")).toBeDefined();
      expect(runtime.listJournal("s2").at(-1)).toMatchObject({ state: "failed", step: "boom" });
      db.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("Timeout: Schritt wird als timeout gemeldet, nicht als exit", async () => {
    const { runtime, db, dir, worktree } = await setupRuntime("timeout");
    try {
      const { emit } = collector();
      const result = await runtime.runSetup({
        sessionId: "s3",
        manifest: manifest([{ id: "hang", argv: ["sleep", "5"], timeoutMs: 500 }]),
        manifestHash: "abc",
        worktreePath: worktree,
        actor: null,
        emit,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.failure.kind).toBe("timeout");
      db.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("Teilfehler: Schritt 1 wirkt, Schritt 2 scheitert — Fehler nennt den schuldigen Schritt", async () => {
    const { runtime, db, dir, worktree } = await setupRuntime("partial");
    try {
      const { emit } = collector();
      const result = await runtime.runSetup({
        sessionId: "s4",
        manifest: manifest([
          { id: "eins", argv: ["touch", "teil.txt"], timeoutMs: 10_000 },
          { id: "zwei", argv: ["exit", "7"], timeoutMs: 10_000 },
        ]),
        manifestHash: "abc",
        worktreePath: worktree,
        actor: null,
        emit,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.failure.step).toBe("zwei");
      db.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("Crash-Semantik: hängen gebliebene dispatching-Operation wird uncertain + genau ein needs_attention, idempotent", async () => {
    const { runtime, db, dir } = await setupRuntime("crash");
    try {
      // Zustand nach einem Hard-Kill mitten im Setup: Journalzeile
      // dispatching (externer Effekt möglicherweise schon begonnen), aber
      // kein abschließendes Event.
      db.prepare(
        "INSERT INTO workspace_operations (id, session_id, kind, state, manifest_hash, actor, created_at, updated_at) VALUES ('op-crash', 's5', 'setup', 'dispatching', 'abc', NULL, ?, ?)",
      ).run(new Date().toISOString(), new Date().toISOString());
      const first = collector();
      expect(await runtime.reconcileAfterCrash("s5", first.emit)).toBe(1);
      expect(first.events.map((e) => e.kind)).toEqual(["workspace.needs_attention"]);
      // zweiter Lauf (K7-Catch-up): nichts Neues, kein zweites Event
      const second = collector();
      expect(await runtime.reconcileAfterCrash("s5", second.emit)).toBe(0);
      expect(second.events).toHaveLength(0);
      expect(runtime.listJournal("s5").at(-1)).toMatchObject({ state: "uncertain" });
      db.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("Teardown: tearing_down → cleanup_failed bei Fehler, Journal art teardown", async () => {
    const { runtime, db, dir, worktree } = await setupRuntime("teardown");
    try {
      const { events, emit } = collector();
      const result = await runtime.runTeardown({
        sessionId: "s6",
        manifest: { schemaVersion: 1, teardown: [{ id: "drop", argv: ["exit", "1"], timeoutMs: 10_000 }] },
        manifestHash: "abc",
        worktreePath: worktree,
        actor: "jan",
        emit,
      });
      expect(result.ok).toBe(false);
      expect(events.map((e) => e.kind)).toEqual(["workspace.tearing_down", "workspace.cleanup_failed"]);
      expect(runtime.listJournal("s6").at(-1)).toMatchObject({ kind: "teardown", state: "failed" });
      db.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("Faltung: letzte workspace.*-Art gewinnt, Service-Events ändern die Phase nicht", async () => {
    const events = [
      { payload: { kind: "workspace.approval_required", manifestHash: "h1" } },
      { payload: { kind: "workspace.preparing", manifestHash: "h1" } },
      { payload: { kind: "workspace.service_ready" } },
      { payload: { kind: "workspace.ready", manifestHash: "h1" } },
      { payload: { kind: "session.started" } },
    ];
    expect(foldWorkspaceState(events)).toEqual({ phase: "ready", manifestHash: "h1" });
    expect(foldWorkspaceState([{ payload: { kind: "session.created" } }])).toBeNull();
  });
});
