import { describe, expect, it } from "vitest";
import { appendFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OrchestrationDispatch, OrchestrationFrame, OrchestrationPlan, OrchestrationRun, OrchestrationTaskPlan } from "@ancientvoid/contracts";
import { applyOutcome, cancelRun, contextPacket, nextDispatches, openGate, answerGate, tasksFromPlan, validatePlan } from "../../../src/modules/orchestration/engine.ts";
import { OrchestrationStore } from "../../../src/modules/orchestration/store.ts";
import { Orchestrator, parsePlan, type OrchestrationSessionPort } from "../../../src/modules/orchestration/coordinator.ts";

const frame = (over: Partial<OrchestrationFrame> = {}): OrchestrationFrame => ({
  adapters: ["codex"],
  coordinatorAdapter: "hermes",
  model: null,
  maxTasks: 8,
  maxDispatchesPerTask: 2,
  maxParallel: 2,
  ...over,
});

const taskPlan = (id: string, over: Partial<OrchestrationTaskPlan> = {}): OrchestrationTaskPlan => ({
  id,
  title: `Task ${id}`,
  prompt: `Prompt für ${id}`,
  adapter: "codex",
  model: null,
  dependsOn: [],
  ...over,
});

const dispatch = (id: string, generation: number, status: OrchestrationDispatch["status"] = "active"): OrchestrationDispatch => ({
  id,
  generation,
  sessionId: `s-${id}`,
  adapter: "codex",
  model: null,
  startedAt: new Date().toISOString(),
  endedAt: null,
  status,
  note: null,
});

const mkRun = (plan: OrchestrationPlan, fr: OrchestrationFrame = frame()): OrchestrationRun => ({
  id: "run-1",
  title: "Test-Run",
  goal: "Ein Ziel",
  project: "p",
  frame: fr,
  planSource: "given",
  coordinatorSessionId: null,
  status: "running",
  tasks: tasksFromPlan(plan),
  gates: [],
  deliveries: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  endedAt: null,
});

describe("EPIC-P40 Orchestrierung — Engine", () => {
  it("validatePlan: unbekannte Abhängigkeit", () => {
    const err = validatePlan({ tasks: [taskPlan("T1", { dependsOn: ["TX"] })] }, frame());
    expect(err?.code).toBe("unknown_dependency");
  });

  it("validatePlan: Zyklus T1→T2→T1", () => {
    const err = validatePlan({ tasks: [taskPlan("T1", { dependsOn: ["T2"] }), taskPlan("T2", { dependsOn: ["T1"] })] }, frame());
    expect(err?.code).toBe("cycle");
  });

  it("validatePlan: Adapter außerhalb des Rahmens", () => {
    const err = validatePlan({ tasks: [taskPlan("T1", { adapter: "loop:evil" })] }, frame());
    expect(err?.code).toBe("adapter_not_allowed");
  });

  it("validatePlan: zu viele Tasks", () => {
    const tasks = Array.from({ length: 5 }, (_, i) => taskPlan(`T${i + 1}`));
    const err = validatePlan({ tasks }, frame({ maxTasks: 4 }));
    expect(err?.code).toBe("too_many_tasks");
  });

  it("validatePlan: valider Plan mit dependsOn passt", () => {
    const err = validatePlan({ tasks: [taskPlan("T1"), taskPlan("T2", { dependsOn: ["T1"] })] }, frame());
    expect(err).toBeNull();
  });

  it("applyOutcome: aktiver Dispatch schließt Task done, Delivery ≤4KB, Downstream wird ready", () => {
    const run = mkRun({ tasks: [taskPlan("T1"), taskPlan("T2", { dependsOn: ["T1"] })] });
    const t1 = run.tasks[0]!;
    t1.status = "running";
    t1.dispatches.push(dispatch("D1", 1));
    const res = applyOutcome(run, "T1", "D1", { ok: true, text: "x".repeat(5000) });
    expect(res.ok).toBe(true);
    expect(t1.status).toBe("done");
    expect(t1.result?.text.length).toBeLessThanOrEqual(4096);
    expect(run.deliveries).toHaveLength(1);
    expect(run.tasks[1]?.status).toBe("ready");
  });

  it("applyOutcome: Ergebnis alter Generation nach neuem Versuch → stale_delivery, Task unverändert", () => {
    const run = mkRun({ tasks: [taskPlan("T1")] });
    const t1 = run.tasks[0]!;
    t1.status = "running";
    t1.dispatches.push(dispatch("D1", 1), dispatch("D2", 2));
    const res = applyOutcome(run, "T1", "D1", { ok: true, text: "alt" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("stale_delivery");
    expect(t1.status).toBe("running");
    expect(t1.result).toBeNull();
    expect(t1.dispatches.find((d) => d.id === "D1")?.status).toBe("stale");
    expect(run.deliveries).toHaveLength(0);
  });

  it("applyOutcome: aktiver Dispatch nach Retry-Ende → Task failed", () => {
    const run = mkRun({ tasks: [taskPlan("T1")] });
    const t1 = run.tasks[0]!;
    t1.dispatches.push(dispatch("D1", 1, "failed"));
    t1.dispatches.push(dispatch("D2", 2));
    t1.status = "running";
    const res = applyOutcome(run, "T1", "D2", { ok: false, text: "", note: "kaputt" });
    expect(res.ok).toBe(true);
    expect(t1.status).toBe("failed");
    expect(run.status).toBe("failed");
  });

  it("applyOutcome: Dispatch nicht aktiv → stale_delivery", () => {
    const run = mkRun({ tasks: [taskPlan("T1")] });
    const t1 = run.tasks[0]!;
    t1.dispatches.push(dispatch("D1", 1, "done"));
    const res = applyOutcome(run, "T1", "D1", { ok: true, text: "spät" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("stale_delivery");
    expect(t1.dispatches[0]?.status).toBe("stale");
  });

  it("nextDispatches: maxParallel begrenzt, nach Abschluss rückt nächster nach", () => {
    const run = mkRun({ tasks: [taskPlan("T1"), taskPlan("T2"), taskPlan("T3")] });
    expect(nextDispatches(run).map((t) => t.id)).toEqual(["T1", "T2"]);
    // Ein aktiver Dispatch belegt einen Platz → nur noch ein Kandidat.
    const t1 = run.tasks[0]!;
    t1.status = "running";
    t1.dispatches.push(dispatch("D1", 1));
    expect(nextDispatches(run).map((t) => t.id)).toEqual(["T2"]);
    // Beide Plätze belegt → nichts frei; nach Abschluss von T2 rückt T3 nach.
    const t2 = run.tasks[1]!;
    t2.status = "running";
    t2.dispatches.push(dispatch("D2", 1));
    expect(nextDispatches(run)).toHaveLength(0);
    applyOutcome(run, "T2", "D2", { ok: true, text: "ok" });
    expect(nextDispatches(run).map((t) => t.id)).toEqual(["T3"]);
  });

  it("openGate/answerGate: Doppelte Antwort → gate_closed; cancel stoppt Run+Dispatches; continue resumed running", () => {
    const run = mkRun({ tasks: [taskPlan("T1"), taskPlan("T2")] });
    const t1 = run.tasks[0]!;
    t1.status = "running";
    t1.dispatches.push(dispatch("D1", 1));
    const gate = openGate(run, {
      id: "G1",
      reason: "worker_question",
      question: "Weiter?",
      options: [
        { label: "Abbrechen", action: "cancel" },
        { label: "Fortsetzen", action: "continue" },
      ],
      taskId: "T1",
    });
    expect(run.status).toBe("awaiting_gate");

    const cancel = answerGate(run, gate.id, "Abbrechen");
    expect(cancel.ok).toBe(true);
    expect(run.status).toBe("cancelled");
    expect(t1.dispatches[0]?.status).toBe("cancelled");
    expect(run.tasks[1]?.status).toBe("unknown");

    // Zweite Antwort wird abgewiesen — Zustand bleibt cancelled.
    const second = answerGate(run, gate.id, "Fortsetzen");
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.code).toBe("gate_closed");
    expect(run.status).toBe("cancelled");

    // continue auf frischem Gate: awaiting_gate → running.
    const run2 = mkRun({ tasks: [taskPlan("T1"), taskPlan("T2")] });
    const g2 = openGate(run2, {
      id: "G2",
      reason: "plan_unreadable",
      question: "Nochmal?",
      options: [{ label: "Erneut versuchen", action: "retry_plan" }],
      taskId: null,
    });
    const cont = answerGate(run2, g2.id, "Erneut versuchen");
    expect(cont.ok).toBe(true);
    expect(run2.status).toBe("running");
  });

  it("cancelRun: nur aktive Dispatches, nicht-terminal Tasks → unknown", () => {
    const run = mkRun({ tasks: [taskPlan("T1"), taskPlan("T2")] });
    const t1 = run.tasks[0]!;
    t1.status = "running";
    t1.dispatches.push(dispatch("D1", 1), dispatch("D0", 1, "done"));
    run.tasks[1]!.status = "pending";
    cancelRun(run, "Test-Stopp");
    expect(t1.dispatches.find((d) => d.id === "D1")?.status).toBe("cancelled");
    expect(t1.dispatches.find((d) => d.id === "D0")?.status).toBe("done");
    expect(t1.status).toBe("unknown");
    expect(run.tasks[1]?.status).toBe("unknown");
    expect(run.status).toBe("cancelled");
    expect(run.endedAt).not.toBeNull();
  });

  it("contextPacket: Titel, Teilaufgabe, Dep-Ergebnis-Vorschau — nicht das Ziel einer fremden Teilaufgabe", () => {
    const plan = {
      tasks: [
        taskPlan("T1", { prompt: "GEHEIM-ZIEL-VON-T1" }),
        taskPlan("T2", { dependsOn: ["T1"], prompt: "Arbeite weiter." }),
      ],
    };
    const run = mkRun(plan);
    const t1 = run.tasks[0]!;
    t1.status = "running";
    t1.dispatches.push(dispatch("D1", 1));
    applyOutcome(run, "T1", "D1", { ok: true, text: "Ergebnis von T1" });
    const packet = contextPacket(run, plan.tasks[1]!);
    expect(packet).toContain(run.title);
    expect(packet).toContain("Arbeite weiter.");
    expect(packet).toContain("Ergebnis von T1");
    expect(packet).not.toContain("GEHEIM-ZIEL-VON-T1");
  });
});

describe("EPIC-P40 Orchestrierung — Store (K7)", () => {
  it("put+update persistiert; neues Store auf gleichem dataDir stellt Run her; kaputte Journalzeile wird gezählt", async () => {
    const dir = mkdtempSync(join(tmpdir(), "av-p40-"));
    const store = new OrchestrationStore(dir);
    await store.init();
    const run = mkRun({ tasks: [taskPlan("T1")] });
    await store.put(run);
    await store.update(run.id, (r) => {
      r.tasks[0]!.status = "running";
    });
    appendFileSync(join(dir, "orchestration", "runs.jsonl"), "{kaputt\n");
    const store2 = new OrchestrationStore(dir);
    const report = await store2.init();
    expect(report.skippedLines).toBe(1);
    expect(report.runs).toBe(1);
    const restored = store2.get(run.id);
    expect(restored?.id).toBe(run.id);
    expect(restored?.tasks[0]?.status).toBe("running");
  });
});

/** Fake-Port: zählt Sessions, Status pro Session steuerbar, lastAssistant liefert Text. */
function fakePort() {
  let n = 0;
  const statuses = new Map<string, string>();
  const texts = new Map<string, string>();
  const created: string[] = [];
  const port: OrchestrationSessionPort = {
    async create() {
      const id = `sess-${++n}`;
      created.push(id);
      statuses.set(id, "working");
      return { id };
    },
    async steer() {
      return null;
    },
    async stop() {
      return null;
    },
    async status(sessionId: string) {
      return statuses.get(sessionId) ?? null;
    },
    async lastAssistant(sessionId: string) {
      const text = texts.get(sessionId);
      return text === undefined ? null : { text, bytes: text.length, blobRef: null };
    },
    async writeBlob() {
      return "blob:1";
    },
  };
  return { port, statuses, texts, created };
}

const startInput = (plan: OrchestrationPlan | null) => ({
  title: "Run",
  goal: "Ziel",
  project: "p",
  frame: frame(),
  plan,
});

async function setup(plan: OrchestrationPlan | null, pollMs = 3_600_000) {
  const dir = mkdtempSync(join(tmpdir(), "av-p40-"));
  const store = new OrchestrationStore(dir);
  await store.init();
  const fake = fakePort();
  const orch = new Orchestrator(store, fake.port, { pollMs });
  const run = await orch.start(startInput(plan), "tester");
  return { dir, store, fake, orch, run };
}

describe("EPIC-P40 Orchestrierung — Orchestrator", () => {
  it("Start mit given plan: dispatcht Ready-Tasks, working→idle ⇒ Delivery, Run done", async () => {
    const { store, fake, orch, run } = await setup({ tasks: [taskPlan("T1")] });
    expect(run.tasks[0]?.status).toBe("running");
    expect(fake.created).toHaveLength(1);
    const sessionId = fake.created[0]!;
    fake.statuses.set(sessionId, "working");
    await orch.tick(); // Dispatch als working gesehen.
    fake.statuses.set(sessionId, "idle");
    fake.texts.set(sessionId, "Fertiges Ergebnis");
    await orch.tick(); // Erstes idle ⇒ Ergebnisübernahme.
    const stored = store.get(run.id)!;
    expect(stored.tasks[0]?.status).toBe("done");
    expect(stored.tasks[0]?.result?.text).toBe("Fertiges Ergebnis");
    expect(stored.deliveries).toHaveLength(1);
    expect(stored.status).toBe("done");
  });

  it("Koordinator-Pfad: Plan-Session liefert ```orchestration {…}``` ⇒ Tasks entstehen", async () => {
    const { store, fake, orch, run } = await setup(null);
    expect(run.status).toBe("planning");
    expect(run.coordinatorSessionId).toBe(fake.created[0]);
    fake.statuses.set(run.coordinatorSessionId!, "idle");
    fake.texts.set(run.coordinatorSessionId!, "```orchestration\n" + JSON.stringify({ tasks: [taskPlan("T1")] }) + "\n```");
    await orch.tick();
    const stored = store.get(run.id)!;
    expect(stored.status).toBe("running");
    expect(stored.tasks.map((t) => t.id)).toEqual(["T1"]);
    expect(stored.planSource).toBe("coordinator");
  });

  it("unlesbarer Plan → Gate plan_unreadable", async () => {
    const { store, fake, orch, run } = await setup(null);
    fake.statuses.set(run.coordinatorSessionId!, "idle");
    fake.texts.set(run.coordinatorSessionId!, "Ich habe leider keinen Plan.");
    await orch.tick();
    const stored = store.get(run.id)!;
    expect(stored.status).toBe("awaiting_gate");
    expect(stored.gates).toHaveLength(1);
    expect(stored.gates[0]?.reason).toBe("plan_unreadable");
    expect(stored.tasks).toHaveLength(0);
  });

  it("recover(): aktive Dispatches → unknown, Task/Run failed, kein neuer Dispatch beim tick", async () => {
    const { dir, run, fake } = await setup({ tasks: [taskPlan("T1")] });
    expect(run.tasks[0]?.dispatches).toHaveLength(1);
    // „Crash“: neuer Store+Orchestrator ohne seen-Set auf gleichem dataDir.
    const store2 = new OrchestrationStore(dir);
    await store2.init();
    const orch2 = new Orchestrator(store2, fake.port, { pollMs: 3_600_000 });
    await orch2.recover();
    const rec = store2.get(run.id)!;
    expect(rec.tasks[0]?.dispatches[0]?.status).toBe("unknown");
    expect(rec.tasks[0]?.status).toBe("unknown");
    expect(rec.status).toBe("failed");
    const before = fake.created.length;
    await orch2.tick();
    expect(fake.created.length).toBe(before); // kein blindes Retry
    expect(store2.get(run.id)?.tasks[0]?.dispatches).toHaveLength(1);
  });
});

describe("EPIC-P40 Orchestrierung — parsePlan", () => {
  const plan = { tasks: [taskPlan("T1")] };

  it("Fence-Block", () => {
    expect(parsePlan("Vorher\n```orchestration\n" + JSON.stringify(plan) + "\n```\nNachher")).toEqual(plan);
  });

  it("nacktes JSON", () => {
    expect(parsePlan(JSON.stringify(plan))).toEqual(plan);
  });

  it("Unsinn → null", () => {
    expect(parsePlan("kein Plan")).toBeNull();
    expect(parsePlan("```orchestration\n{nicht json}\n```")).toBeNull();
  });
});
