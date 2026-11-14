import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { basicFeatures, type Adapter } from "@ancientvoid/contracts";
import { EventStore, HubDatabase, SessionManager, AdapterRegistry } from "../../../src/index.ts";
import { ProcessRunner } from "@ancientvoid/workers";

/**
 * ADR-0074 / BUG-0155 (Issue #62): Eine Session ist so lange `working`, wie
 * zugehörige Arbeit läuft — auch wenn der Adapter das Zugende meldet. Externe
 * Jobs registrieren sich explizit; der Hub rät nie (PRD §8.5).
 */

/** Persistent-worker-Adapter: meldet turn("idle"), sobald der Prompt „fertig" ist. */
function persistentTurnAdapter(): Adapter {
  return {
    id: "persistent",
    version: "0.0.1",
    capabilities: () => ({ reasoning: false, tools: false, cost: false, steer: true, usage: false, nativeDiscovery: "none", nativeResume: "none", features: basicFeatures({ followUp: true, interrupt: true }) }),
    async start(spec, ctx) {
      ctx.turn?.("working");
      if (spec.prompt?.includes("SOFORT_FERTIG")) ctx.turn?.("idle");
      return { sessionId: ctx.sessionId };
    },
    async steer(_handle, input, ctx) {
      if (input.kind === "prompt") {
        ctx.turn?.("working");
        if (!input.text.includes("LAUF_WEITER")) ctx.turn?.("idle");
      }
      return { ok: true };
    },
    async status() {
      return { state: "healthy" };
    },
    async stop() {},
  };
}

async function waitFor(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

function setup(registry: AdapterRegistry, dir: string, store?: EventStore): { manager: SessionManager; db: HubDatabase; store: EventStore } {
  const db = new HubDatabase(":memory:");
  const es = store ?? new EventStore(dir);
  const manager = new SessionManager(db, es, registry, new ProcessRunner());
  return { manager, db, store: es };
}

const kinds = async (manager: SessionManager, id: string) =>
  (await manager.tail(id, 0)).map((e) => (e.payload as { kind?: string }).kind ?? "");

describe("Aktivitätsregister (ADR-0074, BUG-0155)", () => {
  it("Zugende bei laufender Aktivität bleibt working und nennt die offene Arbeit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "av-activity-"));
    const registry = new AdapterRegistry();
    registry.register("persistent", persistentTurnAdapter);
    const { manager, db } = setup(registry, dir);
    try {
      const record = await manager.create({ adapter: "persistent", project: dir, prompt: "start" });
      const job = await manager.registerActivity(record.id, "TTFS-Messlauf (systemd-Unit)");
      expect(job).not.toBeNull();
      // Zug meldet Ende — die Session bleibt working, turn_end bleibt aus.
      await manager.steer(record.id, { kind: "prompt", text: "mach" });
      const pendingSeen = async () => (await kinds(manager, record.id)).includes("session.activity_pending");
      for (let i = 0; i < 100 && !(await pendingSeen()); i++) await new Promise((r) => setTimeout(r, 20));
      expect(manager.get(record.id)?.status).toBe("working");
      expect(await kinds(manager, record.id)).toContain("session.activity_begin");
      expect(await kinds(manager, record.id)).not.toContain("session.turn_end");
      expect(await kinds(manager, record.id)).toContain("session.activity_pending");
      // Letzte Aktivität endet → idle + turn_end.
      expect(await manager.endActivity(record.id!, job!.id)).toBe(true);
      expect(manager.get(record.id)?.status).toBe("idle");
      expect(await kinds(manager, record.id)).toContain("session.activity_end");
      expect(await kinds(manager, record.id)).toContain("session.turn_end");
    } finally {
      await manager.shutdown();
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("Tool-Ende während der laufenden Hauptarbeit beendet den Zug nicht (BUG-0161)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "av-activity-"));
    const registry = new AdapterRegistry();
    registry.register("persistent", persistentTurnAdapter);
    const { manager, db } = setup(registry, dir);
    try {
      const record = await manager.create({ adapter: "persistent", project: dir, prompt: "start" });
      // Hauptzug läuft weiter (turn("working"), kein idle) — wie ein Agent mitten in der Aufgabe.
      await manager.steer(record.id, { kind: "prompt", text: "LAUF_WEITER" });
      for (let i = 0; i < 100 && !(await kinds(manager, record.id)).includes("session.main_turn_start"); i++) {
        await new Promise((r) => setTimeout(r, 20));
      }
      // Provider-Tool-Aktivität: begin → end, während der Hauptzug weiterläuft.
      expect((await manager.activity(record.id, { id: "call_1", kind: "tool", state: "running", label: "grep" })).ok).toBe(true);
      expect((await manager.activity(record.id, { id: "call_1", kind: "tool", state: "completed" })).ok).toBe(true);
      // BUG-0161: Das Tool-Ende ist kein Zugende — Status bleibt working, kein turn_end.
      expect(manager.get(record.id)?.status).toBe("working");
      expect(await kinds(manager, record.id)).not.toContain("session.turn_end");
    } finally {
      await manager.shutdown();
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("Hub-Neustart (K7): offene Aktivitäten kommen aus dem JSONL zurück", async () => {
    const dir = await mkdtemp(join(tmpdir(), "av-activity-"));
    const registry = new AdapterRegistry();
    registry.register("persistent", persistentTurnAdapter);
    const dbPath = join(dir, "hub.db");
    const store = new EventStore(dir);
    {
      const db = new HubDatabase(dbPath);
      const manager = new SessionManager(db, store, registry, new ProcessRunner());
      const record = await manager.create({ adapter: "persistent", project: dir, prompt: "start" });
      await manager.registerActivity(record.id, "Diagnose-Unit");
      db.close(); // K7: Hard-Kill — kein graceful shutdown, die Unit läuft weiter
    }
    // Gleiche Daten (SQLite-Datei + JSONL), neuer Manager = Hub-Neustart.
    const db2 = new HubDatabase(dbPath);
    const manager2 = new SessionManager(db2, store, registry, new ProcessRunner());
    try {
      await manager2.recoverAll();
      const [record] = manager2.list();
      expect(record?.status).toBe("working");
      const beginId = (await manager2.tail(record!.id, 0)).map((e) => (e.payload as { kind?: string; id?: string })).find((e) => e.kind === "session.activity_begin")?.id;
      expect(typeof beginId).toBe("string");
      // Ende nach dem Neustart wird angenommen und schließt den Lauf.
      expect(await manager2.endActivity(record!.id, beginId!, 0)).toBe(true);
      await waitFor(() => manager2.get(record!.id)?.status === "idle", "idle nach spätem Ende");
    } finally {
      await manager2.shutdown();
      db2.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("verspätetes Ende einer unbekannten Aktivität (alte Generation) wird ignoriert", async () => {
    const dir = await mkdtemp(join(tmpdir(), "av-activity-"));
    const registry = new AdapterRegistry();
    registry.register("persistent", persistentTurnAdapter);
    const { manager, db } = setup(registry, dir);
    try {
      const record = await manager.create({ adapter: "persistent", project: dir, prompt: "start" });
      const job = await manager.registerActivity(record.id, "Alter Job");
      await manager.endActivity(record.id!, job!.id);
      await waitFor(() => manager.get(record.id)?.status === "idle", "idle");
      expect(await manager.endActivity(record.id!, job!.id, 0)).toBe(false); // doppelt/alte Generation
      expect(manager.get(record.id)?.status).toBe("idle");
      expect(await manager.registerActivity("gibts-nicht", "x")).toBeNull();
    } finally {
      await manager.shutdown();
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("Registrierung einer Aktivität an einer idle Session macht sie working", async () => {
    const dir = await mkdtemp(join(tmpdir(), "av-activity-"));
    const registry = new AdapterRegistry();
    registry.register("persistent", persistentTurnAdapter);
    const { manager, db } = setup(registry, dir);
    try {
      const record = await manager.create({ adapter: "persistent", project: dir, prompt: "start" });
      await manager.steer(record.id, { kind: "prompt", text: "mach" }); // Zug endet, keine Aktivität
      await waitFor(() => manager.get(record.id)?.status === "idle", "idle nach Zug ohne Aktivität");
      const job = await manager.registerActivity(record.id, "Nacharbeit");
      expect(manager.get(record.id)?.status).toBe("working");
      await manager.endActivity(record.id!, job!.id);
      await waitFor(() => manager.get(record.id)?.status === "idle", "idle nach Ende");
    } finally {
      await manager.shutdown();
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
