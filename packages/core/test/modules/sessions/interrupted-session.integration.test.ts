import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { basicFeatures, type Adapter, type AdapterContext, type AdapterResume, type SessionSummary, type WorkerProcess, type WorkerRunner } from "@ancientvoid/contracts";
import { AdapterRegistry, EventStore, HubDatabase, SessionManager, ApprovalService, buildSessionSummary } from "../../../src/index.ts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });

async function fixture(options: { persistent?: boolean; native?: boolean; resume?: AdapterResume; auto?: boolean; failResume?: boolean | string; stopGate?: Promise<void>; promptless?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "av-interrupted-"));
  const db = new HubDatabase(join(dir, "hub.db"));
  const store = new EventStore(dir);
  let ctx!: AdapterContext;
  let exit!: (code: number | null) => void;
  let starts = 0;
  let crashed = false;
  const digests: SessionSummary[] = [];
  const runner: WorkerRunner = {
    kind: "test", isAvailable: async () => true, list: async () => [], reapOrphans: async () => [], killByName: async () => {},
    async spawn() {
      const proc: WorkerProcess = {
        onStdout() {}, onStderr() {}, onExit(cb) { exit = cb; }, write() {}, kill: async () => {}, exited: async () => ({ code: null }),
      };
      return proc;
    },
  };
  const adapter: Adapter = {
    id: "interrupt-test", version: "1",
    capabilities: () => ({ reasoning: false, tools: false, cost: false, usage: false, steer: true, nativeDiscovery: "none", nativeResume: "none", features: basicFeatures({ followUp: true, interrupt: true }), ...(options.resume ? { resume: options.resume } : {}) }),
    async start(spec, context) {
      starts++;
      if (spec.args?.resumeSessionId && options.failResume) throw new Error(typeof options.failResume === "string" ? options.failResume : "resume failed");
      if (spec.args?.resumeSessionId) expect(spec.args.resumeSessionId).toBe("native-123");
      ctx = context;
      if (options.native !== false) ctx.emit({ type: "system", summary: "native id", payload: { nativeSessionId: "native-123" } });
      if (spec.args?.resumeSessionId && options.promptless) return { sessionId: ctx.sessionId };
      await ctx.spawnWorker(["test-worker"], options.persistent ? { persistent: true } : undefined);
      return { sessionId: ctx.sessionId };
    },
    async recover(id, _seq, context) { ctx = context; await ctx.adoptWorker?.(); return { sessionId: id }; },
    steer: async () => ({ ok: true }), status: async () => ({ state: "down" }), stop: async () => { await options.stopGate; },
  };
  const registry = new AdapterRegistry();
  registry.register(adapter.id, () => adapter);
  const manager = new SessionManager(db, store, registry, runner, 60_000, undefined, undefined, null, [async summary => { digests.push(summary); }], { autoResumeInterrupted: options.auto ?? false });
  cleanup.push(async () => { await manager.shutdown({ keepWorkers: crashed }); db.close(); await rm(dir, { recursive: true, force: true }); });
  const record = await manager.create({ adapter: adapter.id, project: dir, prompt: "work" });
  const events = () => manager.tail(record.id, 0);
  const wait = async (check: () => Promise<boolean>) => {
    for (let i = 0; i < 200; i++) { if (await check()) return; await new Promise((r) => setTimeout(r, 10)); }
    throw new Error("lifecycle condition was not recorded");
  };
  const interrupt = async () => { exit(null); await wait(async () => (await events()).some(e => e.payload.kind === "session.turn_end")); };
  const crash = async () => { crashed = true; await manager.shutdown({ keepWorkers: true }); };
  return { crash, exitCallback: () => exit, dir, db, store, registry, runner, manager, record, events, wait, interrupt, digests, exit: (code: number | null) => exit(code), context: () => ctx, emit: (error = false) => ctx.emit(error ? { type: "error", summary: "agent failed", payload: {} } : { type: "system", summary: "provider failed", payload: { kind: "provider.error" } }), starts: () => starts };
}
const resume: AdapterResume = { argv: ["test", "--resume", "{sessionId}"], ref: "native", hub: true, auto: true };

describe("P27 interruption lifecycle", () => {
  it.each([false, true])("worker exit completes a cut-off turn, persistent=%s", async (persistent) => {
    const f = await fixture({ persistent });
    await f.interrupt();
    expect(f.manager.get(f.record.id)?.status).toBe("interrupted");
    const events = await f.events();
    expect(events.find(e => e.payload.kind === "session.interrupted")?.payload).toMatchObject({ reason: "worker_exit", since: expect.any(String) });
    expect(events.filter(e => e.payload.kind === "session.turn_end")).toHaveLength(1);
    expect(f.manager.notifications().items.filter(n => n.level === "success")).toHaveLength(0);
    expect(f.manager.notifications().items.filter(n => n.kind === "session.interrupted")).toHaveLength(1);
    expect(events.find(e => e.payload.kind === "session.turn_end")?.payload).toMatchObject({ reason: "interrupted" });
    await f.wait(async () => f.manager.turnMetrics(f.record.id).length === 1);
    expect(f.manager.turnMetrics(f.record.id)[0]?.outcome).toBe("error");
    expect(buildSessionSummary(f.manager.get(f.record.id)!, events).lessons).toContainEqual(expect.objectContaining({ kind: "failure", text: expect.stringContaining("worker_exit") }));
    await f.manager.runHeartbeat();
    expect(f.manager.get(f.record.id)?.status).toBe("interrupted");
  });

  it("adapter down without agent error interrupts; repeated heartbeat is idempotent", async () => {
    const f = await fixture();
    await f.manager.runHeartbeat();
    await f.manager.runHeartbeat();
    expect(f.manager.get(f.record.id)?.status).toBe("interrupted");
    expect((await f.events()).filter(e => e.payload.kind === "session.interrupted")).toHaveLength(1);
  });

  it.each([true, false])("an explicit agent/provider error remains error, agent=%s", async (agent) => {
    const f = await fixture();
    f.emit(agent);
    await f.wait(async () => (await f.events()).some(e => e.type === "error" || e.payload.kind === "provider.error"));
    await f.interrupt();
    expect(f.manager.get(f.record.id)?.status).toBe("error");
    expect((await f.events()).some(e => e.payload.kind === "session.interrupted")).toBe(false);
  });

  it("a follow-up prompt right after a failed exit completes the old turn and runs again (BUG-0095, BUG-0100)", async () => {
    const f = await fixture();
    f.emit(false);
    await f.wait(async () => (await f.events()).some(e => e.payload.kind === "provider.error"));
    vi.useFakeTimers();
    try {
      f.exit(1); // fehlerhafter Worker-Exit; die Klassifizierung wartet 250 ms
      // Der Mensch sendet den Folgeprompt, bevor die Klassifizierung läuft —
      // im CI-Rennen (Pipeline 3034339525) schob dieser Prompt die
      // Journal-Grenze und verwandelte den Fehler-Exit in interrupted
      // (BUG-0095); in Pipeline 3038014959 verpuffte er am toten Handle
      // (BUG-0100). Jetzt wird der alte Zug sauber mit turn_end(error)
      // abgeschlossen und die Session macht mit einem neuen Lauf weiter.
      await f.manager.steer(f.record.id, { kind: "prompt", text: "Jetzt wieder" }, "phone");
      await vi.advanceTimersByTimeAsync(600);
    } finally { vi.useRealTimers(); }
    await f.wait(async () => (await f.events()).some(e => e.payload.kind === "session.turn_end"));
    expect((await f.events()).some(e => e.payload.kind === "session.interrupted")).toBe(false);
    expect((await f.events()).find(e => e.payload.kind === "session.turn_end")?.payload).toMatchObject({ reason: "error" });
    await f.wait(async () => f.starts() === 2);
    expect(f.manager.get(f.record.id)?.status).toBe("working");
  });

  it("a prompt after the error classification starts a new run (BUG-0100)", async () => {
    const f = await fixture();
    f.emit(false);
    await f.wait(async () => (await f.events()).some(e => e.payload.kind === "provider.error"));
    await f.interrupt(); // Klassifizierung abgeschlossen: Status error, totes Handle
    expect(f.manager.get(f.record.id)?.status).toBe("error");
    const ack = await f.manager.steer(f.record.id, { kind: "prompt", text: "Jetzt wieder" }, "phone");
    expect(ack.ok).toBe(true);
    // Ohne Fix lief der Prompt über steer auf das tote Handle ins Leere —
    // der Adapter startete nie wieder (Zähler blieb 1, CI-Lauf 3038014959).
    expect(f.starts()).toBe(2);
    expect(f.manager.get(f.record.id)?.status).toBe("working");
  });

  it("explicit park does not misclassify the expected worker exit", async () => {
    const f = await fixture();
    await f.manager.park(f.record.id, "phone");
    vi.useFakeTimers();
    try {
      f.exit(null);
      await vi.advanceTimersByTimeAsync(500);
      await f.manager.runHeartbeat();
      expect(f.manager.get(f.record.id)?.status).toBe("parked");
      expect((await f.events()).some(e => e.payload.kind === "session.interrupted")).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it("planned stop never becomes interrupted", async () => {
    const f = await fixture();
    await f.manager.stop(f.record.id);
    await f.manager.runHeartbeat();
    expect(f.manager.get(f.record.id)?.status).toBe("stopped");
    expect((await f.events()).some(e => e.payload.kind === "session.interrupted")).toBe(false);
  });

  it("dead workers after restart are classified within K7, parked/waiting stay unchanged", async () => {
    const f = await fixture();
    const parked = await f.manager.create({ adapter: "interrupt-test", project: f.dir, prompt: "park" });
    await f.manager.park(parked.id);
    const waiting = await f.manager.create({ adapter: "interrupt-test", project: f.dir, prompt: "wait" });
    f.manager.enableToolPermissions({ approvals: new ApprovalService(f.db), timeoutMs: 60_000 });
    await f.manager.requestToolPermission(waiting.id, { toolName: "Bash", input: { command: "ls" } });
    await f.crash();
    const second = new SessionManager(f.db, new EventStore(f.dir), f.registry, f.runner);
    cleanup.push(() => second.shutdown({ keepWorkers: true }));
    const t = performance.now();
    await second.recoverAll();
    expect(performance.now() - t).toBeLessThan(3000);
    expect(second.get(f.record.id)?.status).toBe("interrupted");
    expect(second.get(parked.id)?.status).toBe("parked");
    expect(second.get(waiting.id)?.status).toBe("waiting_approval");
    expect((await second.tail(f.record.id, 0)).find(e => e.payload.kind === "session.interrupted")?.payload.reason).toBe("hub_restart");
    await second.recoverAll();
    expect((await second.tail(f.record.id, 0)).filter(e => e.payload.kind === "session.turn_end")).toHaveLength(1);
  });

  it("K7: restart completes an interruption whose final turn_end was not written", async () => {
    const f = await fixture();
    await f.interrupt();
    await f.crash();
    const partial = (await f.events()).filter(e => e.payload.kind !== "session.turn_end");
    await writeFile(join(f.dir, "sessions", f.record.id, "events.jsonl"), partial.map(e => JSON.stringify(e)).join("\n") + "\n");
    const second = new SessionManager(f.db, new EventStore(f.dir), f.registry, f.runner);
    cleanup.push(() => second.shutdown({ keepWorkers: true }));
    await second.recoverAll();
    const events = await second.tail(f.record.id, 0);
    expect(events.filter(e => e.payload.kind === "session.interrupted")).toHaveLength(1);
    expect(events.filter(e => e.payload.kind === "session.turn_end")).toHaveLength(1);
    expect(events.map(e => e.seq)).toEqual(events.map((_, i) => i + 1));
    expect(second.get(f.record.id)?.status).toBe("interrupted");
  });

  it("BUG-0149: a promptless resume does not stay working", async () => {
    const f = await fixture({ resume, promptless: true });
    await f.interrupt();
    expect((await f.manager.resume(f.record.id, "phone")).ok).toBe(true);
    expect(f.manager.get(f.record.id)?.status).toBe("idle");
  });

  it("K7: an older completed interruption cannot hide a new interrupted resumed turn", async () => {
    const f = await fixture({ resume });
    await f.interrupt();
    expect((await f.manager.resume(f.record.id, "phone")).ok).toBe(true);
    await f.crash();
    // The second interruption persisted status, then the hub died before its marker.
    f.db.prepare("UPDATE sessions SET status = 'interrupted' WHERE id = ?").run(f.record.id);
    const second = new SessionManager(f.db, new EventStore(f.dir), f.registry, f.runner);
    cleanup.push(() => second.shutdown({ keepWorkers: true }));
    await second.recoverAll();
    await second.recoverAll();
    const events = await second.tail(f.record.id, 0);
    expect(events.filter(e => e.payload.kind === "session.interrupted")).toHaveLength(2);
    expect(events.filter(e => e.payload.kind === "session.turn_end")).toHaveLength(2);
    expect(events.at(-1)?.payload).toMatchObject({ kind: "session.turn_end", reason: "interrupted" });
  });

  it("a reopened stopped run counts only its fresh workers, including a late old exit", async () => {
    const f = await fixture();
    const oldExit = f.exitCallback();
    await f.manager.stop(f.record.id, "phone");
    expect((await f.manager.steer(f.record.id, { kind: "prompt", text: "continue" }, "phone")).ok).toBe(true);
    vi.useFakeTimers();
    try {
      oldExit(null);
      f.exit(0);
      await vi.advanceTimersByTimeAsync(500);
    } finally { vi.useRealTimers(); }
    await f.wait(async () => f.manager.get(f.record.id)?.status === "idle");
    await f.wait(async () => (await f.events()).some(e => e.payload.kind === "session.turn_end"));
  });

  it("native resume is serialized and uses only the recorded provider id", async () => {
    const f = await fixture({ resume });
    await f.interrupt();
    const results = await Promise.all([f.manager.resume(f.record.id, "phone"), f.manager.resume(f.record.id, "phone")]);
    expect(results.filter(r => r.ok)).toHaveLength(1);
    expect(f.starts()).toBe(2);
    expect(f.manager.get(f.record.id)?.status).toBe("working");
  });

  it("resume waits for transport cleanup; old contexts cannot write into the resumed turn", async () => {
    let release!: () => void;
    const stopGate = new Promise<void>(resolve => { release = resolve; });
    const f = await fixture({ resume, stopGate });
    const old = f.context();
    try {
      await f.interrupt();
      const resumed = f.manager.resume(f.record.id, "phone");
      await Promise.resolve();
      expect(f.starts()).toBe(1);
      release();
      expect((await resumed).ok).toBe(true);
      old.emit({ type: "assistant", summary: "stale output", payload: {} });
      old.turn?.("idle");
      expect((await f.events()).some(e => e.summary === "stale output")).toBe(false);
      expect(f.manager.get(f.record.id)?.status).toBe("working");
    } finally { release(); }
  });

  it("undeclared resume uses prompt fallback; Weitermachen stays usable", async () => {
    const f = await fixture();
    await f.interrupt();
    expect((await f.manager.resume(f.record.id, "phone")).ok).toBe(true);
    expect(f.starts()).toBe(2);
    expect(f.manager.get(f.record.id)?.status).toBe("working");
    expect((await f.events()).some(e => e.payload.kind === "session.resume_fallback")).toBe(true);
  });

  it("agent cannot resume or use the legacy steer entry point", async () => {
    const f = await fixture({ resume });
    await f.interrupt();
    expect((await f.manager.resume(f.record.id, "agent:mcp")).ok).toBe(false);
    expect((await f.manager.steer(f.record.id, { kind: "resume" }, "agent:mcp")).ok).toBe(false);
    expect((await f.manager.steer(f.record.id, { kind: "prompt", text: "continue" }, "agent:mcp")).ok).toBe(false);
    expect(f.starts()).toBe(1);
  });

  it("missing native identity falls back to a fresh continue prompt", async () => {
    const f = await fixture({ resume, native: false });
    await f.interrupt();
    expect((await f.manager.resume(f.record.id, "phone")).ok).toBe(true);
    expect(f.starts()).toBe(2);
    expect(f.manager.get(f.record.id)?.status).toBe("working");
    expect((await f.events()).some(e => e.payload.kind === "session.resume_fallback")).toBe(true);
  });

  it("failed native resume tries prompt fallback; sticky error only if that fails too", async () => {
    const f = await fixture({ resume, failResume: true });
    await f.interrupt();
    expect((await f.manager.resume(f.record.id, "phone")).ok).toBe(false);
    expect(f.manager.get(f.record.id)?.status).toBe("error");
    expect((await f.events()).some(e => e.payload.kind === "session.resume_failed")).toBe(true);
    expect((await f.events()).some(e => e.payload.kind === "session.resume_fallback")).toBe(true);
  });

  it("EPIC-P35 T35.4: eine erkennbare Provider-Ursache des gescheiterten Fortsetzens trägt die Kategorie (ADR-0015)", async () => {
    const f = await fixture({ resume, failResume: "Error: usage limit reached for 5 hours, reset at 2026-11-07 20:00:00 +01:00" });
    await f.interrupt();
    expect((await f.manager.resume(f.record.id, "phone")).ok).toBe(false);
    const providerError = (await f.events()).find(e => e.payload.kind === "provider.error");
    expect(providerError?.payload).toMatchObject({ category: "quota", title: expect.stringContaining("Kontingent") });
    expect(providerError?.summary).toContain("interrupt-test");
  });

  it("EPIC-P35 T35.4: ein interner Resume-Fehler bleibt ohne Provider-Kategorie — nichts wird passend gerechnet", async () => {
    const f = await fixture({ resume, failResume: "workdir konnte nicht vorbereitet werden" });
    await f.interrupt();
    expect((await f.manager.resume(f.record.id, "phone")).ok).toBe(false);
    expect((await f.events()).some(e => e.payload.kind === "session.resume_failed")).toBe(true);
    expect((await f.events()).some(e => e.payload.kind === "provider.error")).toBe(false);
  });

  it("auto-resume keeps the interrupted digest at its own journal boundary", async () => {
    const f = await fixture({ auto: true, resume });
    await f.interrupt();
    await f.wait(async () => f.starts() === 2 && f.digests.length > 0);
    const events = await f.events();
    const end = events.find(e => e.payload.kind === "session.turn_end")!;
    expect(f.digests[0]?.eventCount).toBe(end.seq);
    expect(f.digests[0]?.lessons).toContainEqual(expect.objectContaining({ kind: "failure", text: expect.stringContaining("worker_exit") }));
    expect(f.manager.get(f.record.id)?.status).toBe("working");
  });

  it.each([[false, true], [true, false], [true, true]])("auto-resume needs config=%s and declaration=%s", async (auto, declared) => {
    const { auto: _auto, ...manual } = resume;
    const f = await fixture({ auto, resume: declared ? resume : manual });
    await f.interrupt();
    await f.wait(async () => !auto || !declared || f.starts() === 2);
    expect(f.starts()).toBe(auto && declared ? 2 : 1);
  });
});
