import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { basicFeatures, type Adapter, type AdapterContext, type SteerInput } from "@ancientvoid/contracts";
import { ProcessRunner } from "@ancientvoid/workers";
import { AdapterRegistry } from "../../../src/modules/harness/registry.ts";
import { EventStore } from "../../../src/platform/eventstore.ts";
import { HubDatabase } from "../../../src/platform/db.ts";
import { SessionManager } from "../../../src/modules/sessions/session-manager.ts";

/** EPIC-P15 T15.3: Pause und vorgemerkte Nachrichten. */
function fakeAdapter(nextTurn = false) {
  const steered: SteerInput[] = [];
  const ctxs = new Map<string, AdapterContext>();
  let refusePrompts = false;
  let hangPrompts = false;
  const adapter: Adapter = {
    id: "turny",
    version: "0.0.1",
    capabilities: () => ({
      ...(nextTurn ? { promptDelivery: "next-turn" as const } : {}),
      reasoning: false,
      tools: false,
      cost: false,
      steer: true,
      usage: false,
      nativeDiscovery: "none",
      nativeResume: "none",
      features: basicFeatures({ followUp: true, interrupt: true }),
    }),
    async start(_spec, ctx) {
      ctxs.set(ctx.sessionId, ctx);
      return { sessionId: ctx.sessionId };
    },
    async steer(handle, input, ctx) {
      if (input.kind === "prompt" && hangPrompts) return new Promise<{ ok: boolean }>(() => {});
      // BUG-0114: eine Ablehnung heißt „nie angekommen" — solche Versuche werden nicht protokolliert.
      if (input.kind === "prompt" && refusePrompts) return { ok: false, detail: "gerade beschäftigt" };
      steered.push(input);
      if (input.kind === "prompt") ctx.turn?.("working");
      return { ok: true };
    },
    async recover(sessionId, _lastSeq, ctx) {
      ctxs.set(sessionId, ctx);
      await ctx.adoptWorker?.(); // no worker survived: the turn is over
      return { sessionId };
    },
    async status() {
      return { state: "healthy" };
    },
    async stop() {},
  };
  const registry = new AdapterRegistry();
  registry.register("turny", () => adapter);
  /** The provider finishes its turn. */
  const endTurn = (sessionId: string) => ctxs.get(sessionId)!.turn!("idle");
  return { steered, registry, endTurn, refuseNext: () => { refusePrompts = true; }, hangNext: () => { hangPrompts = true; } };
}

async function waitFor(check: () => boolean | Promise<boolean>, ms = 4000): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error("waitFor: Bedingung nicht erfüllt");
}

const setup = async (dbFile?: string, root?: string, nextTurn = false, steerWaitMs?: number) => {
  const dir = root ?? (await mkdtemp(join(tmpdir(), "ancientvoid-queue-")));
  const { steered, registry, endTurn, refuseNext, hangNext } = fakeAdapter(nextTurn);
  const db = new HubDatabase(dbFile ?? ":memory:");
  const sessions = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner(), undefined, undefined, undefined, null, [], steerWaitMs === undefined ? {} : { steerWaitMs });
  return { dir, sessions, steered, endTurn, refuseNext, hangNext, db, registry, done: async () => { await sessions.shutdown(); if (!root) await rm(dir, { recursive: true, force: true }); } };
};

describe("ADR-0074 durable input delivery", () => {
  it("a timed out submission remains queued, marks uncertainty and offers a decision", async () => {
    const f = await setup(undefined, undefined, false, 30);
    try {
      const session = await f.sessions.create({ adapter: "turny", project: f.dir, prompt: "first" });
      await f.sessions.steer(session.id, { kind: "prompt", text: "unknown outcome" }, "phone", { queue: true });
      const item = f.sessions.queued(session.id)[0]!;
      f.hangNext();
      expect(await f.sessions.sendQueuedNow(session.id, item.id, "phone")).toMatchObject({ ok: false });
      expect(f.sessions.queued(session.id)).toContainEqual(expect.objectContaining({ id: item.id, delivery: "unknown" }));
      expect(f.sessions.get(session.id)?.status).toBe("error");
      expect((await f.sessions.tail(session.id, 0)).some(e => e.payload.kind === "session.recovery_blocked")).toBe(true);
    } finally { await f.done(); }
  });
  it("queues next-turn adapters in the hub instead of acknowledging an adapter-local buffer", async () => {
    const f = await setup(undefined, undefined, true);
    try {
      const session = await f.sessions.create({ adapter: "turny", project: f.dir, prompt: "first" });
      expect(await f.sessions.steer(session.id, { kind: "prompt", text: "second" }, "phone")).toMatchObject({ ok: true, detail: "queued" });
      expect(f.steered).toHaveLength(0);
      expect(f.sessions.queued(session.id).map(item => item.text)).toEqual(["second"]);
      f.endTurn(session.id);
      await waitFor(() => f.sessions.queued(session.id).length === 0);
      expect(prompts(f.steered)).toEqual(["second"]);
    } finally { await f.done(); }
  });

  it("keeps the original queued item after a confirmed provider refusal", async () => {
    const f = await setup();
    try {
      const session = await f.sessions.create({ adapter: "turny", project: f.dir, prompt: "first" });
      await f.sessions.steer(session.id, { kind: "prompt", text: "retained" }, "phone", { queue: true });
      const item = f.sessions.queued(session.id)[0]!;
      f.refuseNext();
      f.endTurn(session.id);
      await waitFor(async () => (await f.sessions.tail(session.id, 0)).some(e => e.payload.kind === "session.dequeued"));
      expect(f.sessions.queued(session.id)).toContainEqual(expect.objectContaining({ id: item.id, text: "retained" }));
      expect(f.steered).toHaveLength(0);
    } finally { await f.done(); }
  });

  it("K7 keeps an unacknowledged crash claim visible and never resubmits it", async () => {
    const f = await setup();
    let restored: SessionManager | undefined;
    try {
      const session = await f.sessions.create({ adapter: "turny", project: f.dir, prompt: "first" });
      await f.sessions.steer(session.id, { kind: "prompt", text: "uncertain" }, "phone", { queue: true });
      const item = f.sessions.queued(session.id)[0]!;
      await f.sessions.shutdown({ keepWorkers: true });
      const store = new EventStore(f.dir);
      const tail = await store.replay(session.id);
      await store.append(session.id, [{ seq: tail.at(-1)!.seq + 1, ts: new Date().toISOString(), sessionId: session.id, type: "system", summary: "session.queue_submitting", payload: { kind: "session.queue_submitting", queueId: item.id }, blobRef: null }]);
      restored = new SessionManager(f.db, store, f.registry, new ProcessRunner());
      await restored.recoverAll();
      expect(restored.queued(session.id)).toContainEqual(expect.objectContaining({ id: item.id, delivery: "unknown" }));
      expect(await restored.sendQueuedNow(session.id, item.id, "phone")).toMatchObject({ ok: false });
      expect(f.steered).toHaveLength(0);
    } finally { await restored?.shutdown({ keepWorkers: true }); await f.done(); }
  });
});
const prompts = (steered: SteerInput[]) => steered.filter((s) => s.kind === "prompt").map((s) => (s as { text: string }).text);
const kinds = async (sessions: SessionManager, id: string) =>
  (await sessions.tail(id, 0)).map((e) => (e.payload as { kind?: string }).kind).filter(Boolean);

describe("Vormerken", () => {
  it("hält einen Prompt zurück, solange der Zug läuft, und sendet ihn am Zugende", async () => {
    const { dir, sessions, steered, endTurn, done } = await setup();
    try {
      const rec = await sessions.create({ adapter: "turny", project: dir });
      expect(sessions.get(rec.id)?.status).toBe("working");
      const ack = await sessions.steer(rec.id, { kind: "prompt", text: "danach bitte" }, "jan", { queue: true });
      expect(ack).toEqual({ ok: true, detail: "queued" });
      expect(prompts(steered)).toEqual([]); // nichts ist beim Adapter angekommen
      expect(sessions.queued(rec.id).map((q) => q.text)).toEqual(["danach bitte"]);

      endTurn(rec.id);
      await waitFor(() => prompts(steered).length === 1);
      expect(prompts(steered)).toEqual(["danach bitte"]);
      expect(sessions.queued(rec.id)).toEqual([]);
      expect(await kinds(sessions, rec.id)).toEqual(expect.arrayContaining(["session.queued", "session.dequeued"]));
    } finally {
      await done();
    }
  });

  it("sendet mehrere nacheinander — jeder erst nach dem Ende des Zugs davor", async () => {
    const { dir, sessions, steered, endTurn, done } = await setup();
    try {
      const rec = await sessions.create({ adapter: "turny", project: dir });
      await sessions.steer(rec.id, { kind: "prompt", text: "eins" }, undefined, { queue: true });
      await sessions.steer(rec.id, { kind: "prompt", text: "zwei" }, undefined, { queue: true });
      endTurn(rec.id);
      await waitFor(() => prompts(steered).length === 1);
      await new Promise((r) => setTimeout(r, 120));
      expect(prompts(steered)).toEqual(["eins"]); // „zwei“ wartet auf das Ende von „eins“
      endTurn(rec.id);
      await waitFor(() => prompts(steered).length === 2);
      expect(prompts(steered)).toEqual(["eins", "zwei"]);
    } finally {
      await done();
    }
  });

  it("ohne queue-Flag geht ein Prompt wie bisher sofort zum Adapter", async () => {
    const { dir, sessions, steered, done } = await setup();
    try {
      const rec = await sessions.create({ adapter: "turny", project: dir });
      const ack = await sessions.steer(rec.id, { kind: "prompt", text: "sofort" });
      expect(ack.ok).toBe(true);
      expect(prompts(steered)).toEqual(["sofort"]);
      expect(sessions.queued(rec.id)).toEqual([]);
    } finally {
      await done();
    }
  });

  it("ein Eintrag lässt sich vor dem Senden streichen", async () => {
    const { dir, sessions, steered, endTurn, done } = await setup();
    try {
      const rec = await sessions.create({ adapter: "turny", project: dir });
      await sessions.steer(rec.id, { kind: "prompt", text: "doch nicht" }, undefined, { queue: true });
      const [item] = sessions.queued(rec.id);
      expect(await sessions.unqueue(rec.id, item!.id, "jan")).toBe(true);
      expect(await sessions.unqueue(rec.id, item!.id)).toBe(false);
      endTurn(rec.id);
      await new Promise((r) => setTimeout(r, 150));
      expect(prompts(steered)).toEqual([]);
    } finally {
      await done();
    }
  });

  it("BUG-0114: ein vorgemerkter Prompt lässt sich sofort in den laufenden Zug senden", async () => {
    const { dir, sessions, steered, endTurn, done } = await setup();
    try {
      const rec = await sessions.create({ adapter: "turny", project: dir });
      expect(sessions.get(rec.id)?.status).toBe("working"); // der Zug läuft noch
      await sessions.steer(rec.id, { kind: "prompt", text: "zwischenfrage" }, "jan", { queue: true });
      await sessions.steer(rec.id, { kind: "prompt", text: "danach" }, "jan", { queue: true });
      const [first] = sessions.queued(rec.id);

      const ack = await sessions.sendQueuedNow(rec.id, first!.id, "jan");
      expect(ack.ok).toBe(true);
      // sofort beim Adapter angekommen — ohne dass der Zug geendet hat (endTurn fehlt absichtlich)
      expect(prompts(steered)).toEqual(["zwischenfrage"]);
      expect(sessions.queued(rec.id).map((q) => q.text)).toEqual(["danach"]);
      expect(await kinds(sessions, rec.id)).toContain("session.dequeued");

      // der Rest bleibt beim alten Vertrag: erst nach dem Ende des laufenden Zugs
      endTurn(rec.id);
      await waitFor(() => prompts(steered).length === 2);
      expect(prompts(steered)).toEqual(["zwischenfrage", "danach"]);
    } finally {
      await done();
    }
  });

  it("BUG-0114: lehnt der Adapter ab, bleibt die Nachricht vorgemerkt und der Grund sichtbar", async () => {
    const { dir, sessions, steered, refuseNext, done } = await setup();
    try {
      const rec = await sessions.create({ adapter: "turny", project: dir });
      await sessions.steer(rec.id, { kind: "prompt", text: "kritische frage" }, "jan", { queue: true });
      const [item] = sessions.queued(rec.id);
      refuseNext();

      const ack = await sessions.sendQueuedNow(rec.id, item!.id, "jan");
      expect(ack).toEqual({ ok: false, detail: "gerade beschäftigt" });
      expect(sessions.queued(rec.id).map((q) => q.text)).toEqual(["kritische frage"]); // kein Textverlust
      expect(prompts(steered)).toEqual([]);
      const events = await sessions.tail(rec.id, 0);
      expect(events.some((e) => e.payload.kind === "session.dequeued" && (e.payload as { ok?: boolean }).ok === false)).toBe(true);
    } finally {
      await done();
    }
  });

  it("derselbe Eingabe-Schlüssel wird nicht zweimal vorgemerkt", async () => {
    const { dir, sessions, done } = await setup();
    try {
      const rec = await sessions.create({ adapter: "turny", project: dir });
      await sessions.steer(rec.id, { kind: "prompt", text: "einmal" }, undefined, { queue: true, inputId: "in-1" });
      const again = await sessions.steer(rec.id, { kind: "prompt", text: "einmal" }, undefined, { queue: true, inputId: "in-1" });
      expect(again.detail).toBe("duplicate input ignored");
      expect(sessions.queued(rec.id)).toHaveLength(1);
    } finally {
      await done();
    }
  });

  it("Stop leert die Warteschlange", async () => {
    const { dir, sessions, steered, endTurn, done } = await setup();
    try {
      const rec = await sessions.create({ adapter: "turny", project: dir });
      await sessions.steer(rec.id, { kind: "prompt", text: "wird verworfen" }, undefined, { queue: true });
      await sessions.stop(rec.id);
      expect(sessions.queued(rec.id)).toEqual([]);
      endTurn(rec.id);
      await new Promise((r) => setTimeout(r, 120));
      expect(prompts(steered)).toEqual([]);
    } finally {
      await done();
    }
  });

  it("überlebt einen Hub-Neustart (K7): wartet nach Interrupt auf menschliches Fortsetzen", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-queue-restart-"));
    const file = join(dir, "hub.db");
    const first = await setup(file, dir);
    try {
      const id = (await first.sessions.create({ adapter: "turny", project: dir })).id;
      await first.sessions.steer(id, { kind: "prompt", text: "nach dem Neustart" }, "jan", { queue: true });
      await first.sessions.shutdown({ keepWorkers: true });

      const second = await setup(file, dir);
      try {
        expect(second.sessions.queued(id).map((q) => q.text)).toEqual(["nach dem Neustart"]);
        await second.sessions.recoverAll();
        expect(second.sessions.get(id)?.status).toBe("interrupted");
        expect(prompts(second.steered)).toEqual([]);
        expect(second.sessions.queued(id)).toHaveLength(1);
        await second.sessions.steer(id, { kind: "prompt", text: "Mensch setzt fort" }, "jan");
        second.endTurn(id);
        await waitFor(() => prompts(second.steered).length === 1);
        expect(prompts(second.steered)).toEqual(["nach dem Neustart"]);
        expect(second.sessions.queued(id)).toEqual([]);
      } finally {
        await second.sessions.shutdown();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("Pause", () => {
  it("park hält den Zug an UND setzt den Status auf pausiert; ein neuer Prompt macht weiter", async () => {
    const { dir, sessions, steered, done } = await setup();
    try {
      const rec = await sessions.create({ adapter: "turny", project: dir });
      const ack = await sessions.steer(rec.id, { kind: "park" }, "jan");
      expect(ack.ok).toBe(true);
      expect(steered.map((s) => s.kind)).toContain("park");
      expect(sessions.get(rec.id)).toMatchObject({ status: "parked", parkReason: "manual" });
      expect(await kinds(sessions, rec.id)).toContain("session.parked");

      // zweimal Pause ändert nichts
      expect((await sessions.steer(rec.id, { kind: "park" })).ok).toBe(true);

      const resumed = await sessions.steer(rec.id, { kind: "prompt", text: "weiter" });
      expect(resumed.ok).toBe(true);
      expect(prompts(steered)).toEqual(["weiter"]);
      expect(sessions.get(rec.id)?.status).toBe("working");
    } finally {
      await done();
    }
  });
});
