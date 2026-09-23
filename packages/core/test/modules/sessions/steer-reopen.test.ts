import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStore, HubDatabase, SessionManager, AdapterRegistry } from "../../../src/index.ts";
import { ProcessRunner } from "@uacc/workers";
import { createAdapter as createDummy } from "@uacc/adapter-dummy";

/** A stopped session that takes a prompt starts the provider again. That
 * reopen must obey the same input-id / lease rules as a live steer. */
async function stoppedSession() {
  const dir = await mkdtemp(join(tmpdir(), "uacc-reopen-"));
  const db = new HubDatabase(":memory:");
  const registry = new AdapterRegistry();
  let starts = 0;
  registry.register(
    "dummy",
    (config) => {
      const inner = createDummy(config);
      return {
        ...inner,
        start: async (spec, ctx) => {
          starts++;
          return inner.start(spec, ctx);
        },
      };
    },
    { eventsPerSecond: 5, autoStopAfterEvents: 0 },
  );
  const manager = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
  const record = await manager.create({ adapter: "dummy", project: dir, prompt: "first" });
  await manager.stop(record.id);
  const cleanup = async () => {
    await manager.shutdown();
    db.close();
    await rm(dir, { recursive: true, force: true });
  };
  return { manager, id: record.id, starts: () => starts, cleanup };
}

describe("reopening a stopped session (AC-P5-4)", () => {
  it("BUG-0016: a retried input id does not start the provider twice", async () => {
    const s = await stoppedSession();
    try {
      const first = await s.manager.steer(s.id, { kind: "prompt", text: "weiter" }, "phone", { inputId: "in-1" });
      expect(first.ok).toBe(true);
      await s.manager.stop(s.id);
      const retry = await s.manager.steer(s.id, { kind: "prompt", text: "weiter" }, "phone", { inputId: "in-1" });
      expect(retry).toEqual({ ok: true, detail: "duplicate input ignored" });
      expect(s.starts()).toBe(2);
      expect(s.manager.get(s.id)?.inputRevision).toBe(1);
    } finally {
      await s.cleanup();
    }
  });

  it("BUG-0017: two clients reopening at once start exactly one run", async () => {
    const s = await stoppedSession();
    try {
      const acks = await Promise.all([
        s.manager.steer(s.id, { kind: "prompt", text: "vom Handy" }, "phone", { inputId: "p-1", clientId: "phone" }),
        s.manager.steer(s.id, { kind: "prompt", text: "vom PC" }, "desktop", { inputId: "d-1", clientId: "desktop" }),
      ]);
      expect(acks[0]).toEqual({ ok: true });
      expect(acks[1]).toEqual({ ok: false, detail: "writer lease held" });
      expect(s.starts()).toBe(2);
      expect(s.manager.get(s.id)?.writerClient).toBe("phone");
    } finally {
      await s.cleanup();
    }
  });
});
