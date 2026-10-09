import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { basicFeatures, type Adapter, type AdapterContext, type SteerInput } from "@uacc/contracts";
import { ProcessRunner } from "@uacc/workers";
import { AdapterRegistry } from "../../../src/modules/harness/registry.ts";
import { EventStore } from "../../../src/platform/eventstore.ts";
import { HubDatabase } from "../../../src/platform/db.ts";
import { SessionManager } from "../../../src/modules/sessions/session-manager.ts";

/** EPIC-P15 T15.3: Pause und vorgemerkte Nachrichten. */
function fakeAdapter() {
  const steered: SteerInput[] = [];
  const ctxs = new Map<string, AdapterContext>();
  const adapter: Adapter = {
    id: "turny",
    version: "0.0.1",
    capabilities: () => ({
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
  return { steered, registry, endTurn };
}

async function waitFor(check: () => boolean | Promise<boolean>, ms = 4000): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error("waitFor: Bedingung nicht erfüllt");
}

const setup = async (dbFile?: string, root?: string) => {
  const dir = root ?? (await mkdtemp(join(tmpdir(), "uacc-queue-")));
  const { steered, registry, endTurn } = fakeAdapter();
  const db = new HubDatabase(dbFile ?? ":memory:");
  const sessions = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
  return { dir, sessions, steered, endTurn, db, done: async () => { await sessions.shutdown(); if (!root) await rm(dir, { recursive: true, force: true }); } };
};
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

  it("überlebt einen Hub-Neustart (K7): nach der Recovery geht der Eintrag raus", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uacc-queue-restart-"));
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
