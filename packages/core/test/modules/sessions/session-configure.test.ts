import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { basicFeatures, type Adapter, type SessionSpec, type SteerInput } from "@ancientvoid/contracts";
import { ProcessRunner } from "@ancientvoid/workers";
import { AdapterRegistry } from "../../../src/modules/harness/registry.ts";
import { refuseSpec, refuseSteer } from "../../../src/modules/harness/features.ts";
import { EventStore } from "../../../src/platform/eventstore.ts";
import { HubDatabase } from "../../../src/platform/db.ts";
import { SessionManager } from "../../../src/modules/sessions/session-manager.ts";

/** ADR-0033: Modus und Modell einer Session wählen und wechseln. */
describe("ADR-0033 feature gate", () => {
  const modal = basicFeatures({ modelChoice: "start", modelSwitch: true, permissionModes: ["auto", "manual"] });

  it("refuses an unknown mode at start and a switch the adapter does not offer", () => {
    expect(refuseSpec(modal, "claude", { args: { permissionMode: "auto" } })).toBeNull();
    expect(refuseSpec(modal, "claude", { args: { permissionMode: "yolo" } })).toBe("claude kennt den Modus „yolo“ nicht.");
    expect(refuseSpec(basicFeatures(), "aider", { args: { permissionMode: "auto" } })).toBe("aider kennt den Modus „auto“ nicht.");

    expect(refuseSteer(modal, "claude", { kind: "configure", permissionMode: "manual", model: "opus" })).toBeNull();
    expect(refuseSteer(modal, "claude", { kind: "configure", permissionMode: "yolo" })).toBe("claude kennt den Modus „yolo“ nicht.");
    expect(refuseSteer(modal, "claude", { kind: "configure" })).toBe("Nichts zu ändern.");
    expect(refuseSteer(basicFeatures({ permissionModes: ["auto"] }), "x", { kind: "configure", model: "m" })).toBe("x kann das Modell nach dem Start nicht wechseln.");
  });
});

describe("ADR-0033 SessionManager", () => {
  function setup(opts: { modes?: readonly string[]; modelSwitch?: boolean; refuse?: boolean } = {}) {
    const calls: { start: SessionSpec[]; steer: SteerInput[]; steerModel: (string | null | undefined)[] } = { start: [], steer: [], steerModel: [] };
    const adapter: Adapter = {
      id: "modal",
      version: "0.0.1",
      capabilities: () => ({
        reasoning: false,
        tools: false,
        cost: false,
        steer: true,
        usage: false,
        nativeDiscovery: "none",
        nativeResume: "none",
        features: basicFeatures({ modelChoice: "start", modelSwitch: opts.modelSwitch ?? true, permissionModes: opts.modes ?? ["auto", "manual", "plan"] }),
      }),
      async start(spec, ctx) {
        calls.start.push(spec);
        return { sessionId: ctx.sessionId };
      },
      async steer(_h, input, ctx) {
        calls.steer.push(input);
        calls.steerModel.push(ctx.model);
        return opts.refuse ? { ok: false, detail: "nein" } : { ok: true };
      },
      async status() {
        return { state: "healthy" };
      },
      async stop() {},
    };
    const registry = new AdapterRegistry();
    registry.register("modal", () => adapter);
    return { calls, registry };
  }
  const make = async (registry: AdapterRegistry, defaultMode: string | null) => {
    const root = await mkdtemp(join(tmpdir(), "ancientvoid-configure-"));
    const db = new HubDatabase(":memory:");
    const sessions = new SessionManager(db, new EventStore(root), registry, new ProcessRunner(), undefined, undefined, undefined, null, [], {}, undefined, defaultMode);
    return { root, db, sessions, done: async () => { await sessions.shutdown(); await rm(root, { recursive: true, force: true }); } };
  };

  it("the hub default applies where the adapter has that mode, and an explicit mode wins", async () => {
    const { calls, registry } = setup();
    const { root, sessions, done } = await make(registry, "auto");
    try {
      const byDefault = await sessions.create({ adapter: "modal", project: root });
      expect(byDefault.permissionMode).toBe("auto");
      expect(calls.start[0]!.args).toMatchObject({ permissionMode: "auto" });

      const explicit = await sessions.create({ adapter: "modal", project: root, args: { permissionMode: "plan" } });
      expect(explicit.permissionMode).toBe("plan");
      expect(calls.start[1]!.args).toMatchObject({ permissionMode: "plan" });
    } finally {
      await done();
    }
  });

  it("an adapter without that mode is left alone, and no default means no mode", async () => {
    const { calls, registry } = setup({ modes: [] });
    const { root, sessions, done } = await make(registry, "auto");
    try {
      const record = await sessions.create({ adapter: "modal", project: root });
      expect(record.permissionMode).toBeNull();
      expect(calls.start[0]!.args ?? {}).not.toHaveProperty("permissionMode");
    } finally {
      await done();
    }
    const other = setup();
    const m = await make(other.registry, null);
    try {
      expect((await m.sessions.create({ adapter: "modal", project: m.root })).permissionMode).toBeNull();
    } finally {
      await m.done();
    }
  });

  it("configure reaches the adapter, is stored, and leaves an event (K7)", async () => {
    const { calls, registry } = setup();
    const { root, db, sessions, done } = await make(registry, "auto");
    try {
      const record = await sessions.create({ adapter: "modal", project: root, model: "haiku" });
      const ack = await sessions.steer(record.id, { kind: "configure", permissionMode: "manual", model: "sonnet" }, "jan");
      expect(ack.ok).toBe(true);
      expect(calls.steer).toEqual([{ kind: "configure", permissionMode: "manual", model: "sonnet" }]);
      expect(sessions.get(record.id)).toMatchObject({ permissionMode: "manual", model: "sonnet" });
      // the change survives a read from the database
      expect(db.prepare("SELECT permission_mode, model FROM sessions WHERE id = ?").get(record.id)).toMatchObject({ permission_mode: "manual", model: "sonnet" });
      const event = (await sessions.tail(record.id, 0)).find((e) => (e.payload as { kind?: string }).kind === "session.configured");
      expect(event?.payload).toMatchObject({ model: "sonnet", permissionMode: "manual", actor: "jan" });
    } finally {
      await done();
    }
  });

  it("ADR-0061: der Adapter sieht das aktuelle Modell der Session im Kontext — auch nach configure", async () => {
    const { calls, registry } = setup();
    const { root, sessions, done } = await make(registry, null);
    try {
      const record = await sessions.create({ adapter: "modal", project: root, model: "haiku" });
      await sessions.steer(record.id, { kind: "prompt", text: "eins" });
      await sessions.steer(record.id, { kind: "configure", model: "sonnet" });
      await sessions.steer(record.id, { kind: "prompt", text: "zwei" });
      // prompt, configure (läuft noch auf dem alten), prompt (schon auf dem neuen)
      expect(calls.steerModel).toEqual(["haiku", "haiku", "sonnet"]);
    } finally {
      await done();
    }
  });

  it("configure is refused before the adapter when it cannot do it, and relays the adapter's no", async () => {
    const plain = setup({ modes: [], modelSwitch: false });
    const a = await make(plain.registry, null);
    try {
      const record = await a.sessions.create({ adapter: "modal", project: a.root });
      const ack = await a.sessions.steer(record.id, { kind: "configure", permissionMode: "auto" });
      expect(ack).toEqual({ ok: false, detail: "modal kennt den Modus „auto“ nicht." });
      expect(plain.calls.steer).toEqual([]);
    } finally {
      await a.done();
    }
    const strict = setup({ refuse: true });
    const b = await make(strict.registry, "auto");
    try {
      const record = await b.sessions.create({ adapter: "modal", project: b.root });
      const ack = await b.sessions.steer(record.id, { kind: "configure", permissionMode: "plan" });
      expect(ack).toEqual({ ok: false, detail: "nein" });
      expect(b.sessions.get(record.id)?.permissionMode).toBe("auto"); // unchanged
    } finally {
      await b.done();
    }
  });

  it("a stopped session continues in the mode and model chosen while it was stopped", async () => {
    const { calls, registry } = setup();
    const { root, sessions, done } = await make(registry, "auto");
    try {
      const record = await sessions.create({ adapter: "modal", project: root, model: "haiku" });
      await sessions.stop(record.id);
      expect((await sessions.steer(record.id, { kind: "configure", permissionMode: "plan", model: "opus" })).ok).toBe(true);
      expect((await sessions.steer(record.id, { kind: "prompt", text: "weiter" })).ok).toBe(true);
      const restart = calls.start.at(-1)!;
      expect(restart.model).toBe("opus");
      expect(restart.args).toMatchObject({ permissionMode: "plan" });
    } finally {
      await done();
    }
  });
});
