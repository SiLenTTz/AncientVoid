import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStore } from "../../../src/platform/eventstore.ts";
import { HubDatabase } from "../../../src/platform/db.ts";
import { AdapterRegistry } from "../../../src/modules/harness/registry.ts";
import { SessionManager } from "../../../src/modules/sessions/session-manager.ts";
import { collectHealth } from "../../../src/modules/observability/health.ts";
import { ProcessRunner } from "@uacc/workers";
import { createAdapter as createDummy } from "@uacc/adapter-dummy";

describe("collectHealth (T4.5-4)", () => {
  it("reports ok when db and event store probe succeed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uacc-health-"));
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy);
    const sessions = new SessionManager(db, store, registry, new ProcessRunner());
    try {
      const report = await collectHealth({
        startedAt: Date.now() - 1500,
        sessions,
        registry,
        store,
      });
      expect(report.ok).toBe(true);
      expect(report.status).toBe("ok");
      expect(report.checks.database.ok).toBe(true);
      expect(report.checks.eventStore.ok).toBe(true);
      expect(report.checks.memory).toMatchObject({ level: "ok", ok: true });
      expect(report.sessions.total).toBe(0);
      expect(report.adapters.some((a) => a.id === "dummy")).toBe(true);
      expect(report.uptimeSec).toBeGreaterThanOrEqual(1);
    } finally {
      await sessions.shutdown();
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("goes down when the event store probe fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uacc-health-"));
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    const sessions = new SessionManager(db, store, registry, new ProcessRunner());
    try {
      const report = await collectHealth({
        startedAt: Date.now(),
        sessions,
        registry,
        store: {
          probe: async () => {
            throw new Error("disk full");
          },
        },
      });
      expect(report.ok).toBe(false);
      expect(report.status).toBe("down");
      expect(report.checks.eventStore.ok).toBe(false);
      expect(report.checks.eventStore.detail).toMatch(/disk full/);
    } finally {
      await sessions.shutdown();
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
