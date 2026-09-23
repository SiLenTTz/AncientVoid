import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { basicFeatures, type Adapter, type NormalizedEvent } from "@uacc/contracts";
import { ProcessRunner } from "@uacc/workers";
import { AdapterRegistry } from "../src/registry.ts";
import { ApprovalService } from "../src/approvals.ts";
import { EventStore } from "../src/eventstore.ts";
import { HubDatabase } from "../src/db.ts";
import { SessionManager } from "../src/sessionmanager.ts";

/**
 * T7.3 / AC-P7-3: a hub crash before the decision, after it and while the
 * approved prompt runs — no request lost, no side effect twice, the
 * uncertain case visible. A "crash" is a second SessionManager on the same
 * SQLite file and JSONL directory, as after a real restart.
 */
describe("durable approval-gated operations (T7.3)", () => {
  let dir: string;
  const prompts: string[] = [];

  const adapter: Adapter = {
    id: "rec",
    version: "0.0.1",
    capabilities: () => ({
      reasoning: false,
      tools: false,
      cost: false,
      steer: true,
      usage: false,
      nativeDiscovery: "none",
      nativeResume: "native",
      features: basicFeatures(),
    }),
    async start(_spec, ctx) {
      return { sessionId: ctx.sessionId };
    },
    async steer(_h, input) {
      if (input.kind === "prompt") prompts.push(input.text);
      return { ok: true };
    },
    async status() {
      return { state: "healthy" };
    },
    async stop() {},
    async recover(sessionId) {
      return { sessionId };
    },
  };

  function hub() {
    const db = new HubDatabase(join(dir, "hub.db"));
    const registry = new AdapterRegistry();
    registry.register("rec", () => adapter);
    const approvals = new ApprovalService(db);
    const sessions = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner(), 60_000, undefined, approvals);
    return { db, approvals, sessions };
  }

  async function kinds(sessions: SessionManager, id: string): Promise<string[]> {
    const events = (await sessions.tail(id, 0, 1000)) as NormalizedEvent[];
    return events.map((e) => String((e.payload as { kind?: unknown }).kind ?? ""));
  }

  async function pendingPrompt(): Promise<{ sessionId: string; approvalId: string }> {
    const first = hub();
    const record = await first.sessions.create({ adapter: "rec", project: dir });
    const ack = await first.sessions.steer(record.id, { kind: "prompt", text: "Bitte deployen" });
    expect(ack.ok).toBe(false);
    const approvalId = ack.detail!.replace("pending approval ", "");
    expect(first.sessions.operation(approvalId)).toMatchObject({ state: "pending", kind: "steer.prompt" });
    await first.sessions.shutdown({ keepWorkers: true }); // the hub dies, nothing is stopped
    return { sessionId: record.id, approvalId };
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "uacc-ops-"));
    prompts.length = 0;
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("crash before the decision: the request survives and runs once when approved", async () => {
    const { approvalId } = await pendingPrompt();
    const second = hub();
    await second.sessions.recoverAll();
    expect(second.sessions.operation(approvalId)?.state).toBe("pending");
    expect(second.approvals.decide(approvalId, "approve", "raw-token", "pixel").ok).toBe(true);
    expect((await second.sessions.applyApprovedSteer(approvalId, "pixel")).ok).toBe(true);
    // a retried decide (or a second tab) finds it taken
    expect(await second.sessions.applyApprovedSteer(approvalId, "pixel")).toEqual({ ok: false, detail: "operation already done" });
    expect(prompts).toEqual(["Bitte deployen"]);
    await second.sessions.shutdown({ keepWorkers: true });
  });

  it("crash after the decision, before dispatch: the restart runs it, once", async () => {
    const { sessionId, approvalId } = await pendingPrompt();
    const between = hub();
    expect(between.approvals.decide(approvalId, "approve", "raw-token", "pixel").ok).toBe(true);
    // the hub dies before the decide route reached applyApprovedSteer
    const second = hub();
    await second.sessions.recoverAll();
    expect(prompts).toEqual(["Bitte deployen"]);
    expect(second.sessions.operation(approvalId)).toMatchObject({ state: "done", outcome: "ausgeführt" });
    expect(await kinds(second.sessions, sessionId)).toContain("operation.resumed");
    const third = hub();
    await third.sessions.recoverAll();
    expect(prompts, "a second restart does not run it again").toEqual(["Bitte deployen"]);
    await second.sessions.shutdown({ keepWorkers: true });
    await third.sessions.shutdown({ keepWorkers: true });
  });

  it("crash while dispatching: uncertain, visible, never re-run", async () => {
    const { sessionId, approvalId } = await pendingPrompt();
    const between = hub();
    between.approvals.decide(approvalId, "approve", "raw-token", "pixel");
    // the hub died inside adapter.steer(): state dispatching, outcome unknown
    between.db.prepare("UPDATE operations SET state = 'dispatching' WHERE id = ?").run(approvalId);
    const second = hub();
    await second.sessions.recoverAll();
    expect(prompts).toEqual([]);
    expect(second.sessions.operation(approvalId)?.state).toBe("uncertain");
    expect(await kinds(second.sessions, sessionId)).toContain("operation.uncertain");
    expect(second.sessions.notifications().items.map((n) => n.title)).toContain(`${dir.split("/").pop()} · Ausführung ungewiss`);
    await second.sessions.shutdown({ keepWorkers: true });
  });

  it("a rejection or timeout never runs; changed arguments are refused", async () => {
    const { approvalId } = await pendingPrompt();
    const second = hub();
    await second.sessions.recoverAll();
    second.approvals.decide(approvalId, "reject", "raw-token", "pixel");
    await second.sessions.recordApprovalDecision(second.sessions.operation(approvalId)!.sessionId, approvalId, "steer.prompt", "rejected", "pixel");
    expect(second.sessions.operation(approvalId)?.state).toBe("rejected");
    expect((await second.sessions.applyApprovedSteer(approvalId)).ok).toBe(false);

    const record = await second.sessions.create({ adapter: "rec", project: dir });
    const ack = await second.sessions.steer(record.id, { kind: "prompt", text: "harmlos" });
    const tampered = ack.detail!.replace("pending approval ", "");
    second.approvals.decide(tampered, "approve", "raw-token", "pixel");
    second.db
      .prepare("UPDATE operations SET payload = ? WHERE id = ?")
      .run(JSON.stringify({ input: { kind: "prompt", text: "rm -rf /" }, typed: "harmlos" }), tampered);
    expect(await second.sessions.applyApprovedSteer(tampered)).toEqual({ ok: false, detail: "operation arguments changed after approval" });
    expect(prompts).toEqual([]);
    await second.sessions.shutdown({ keepWorkers: true });
  });
});
