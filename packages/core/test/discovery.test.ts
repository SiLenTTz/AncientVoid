import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DiscoveredSession } from "@uacc/contracts";
import { EventStore, HubDatabase, SessionManager, AdapterRegistry } from "../src/index.ts";
import { dedupeDiscovered } from "../src/discovery.ts";
import { ProcessRunner } from "@uacc/workers";
import { createAdapter as createDummy } from "@uacc/adapter-dummy";

function item(partial: Partial<DiscoveredSession> & Pick<DiscoveredSession, "adapter" | "nativeSessionId" | "hubSessionId">): DiscoveredSession {
  return {
    project: "/tmp/a",
    status: "working",
    controlMode: "managed",
    harness: "cli",
    hostId: "local",
    resumeVersion: 1,
    observedAt: "2026-09-21T00:00:00.000Z",
    unsupportedResume: false,
    fork: false,
    ...partial,
  };
}

describe("dedupeDiscovered (AC-P5-1)", () => {
  it("collapses the same native id and keeps the hub record", () => {
    const hub = item({ hubSessionId: "hub-1", adapter: "claude", nativeSessionId: "native-1", project: "/tmp/a" });
    const external = item({ hubSessionId: null, adapter: "claude", nativeSessionId: "native-1", project: "/tmp/a", controlMode: "observed" });
    const other = item({ hubSessionId: "hub-2", adapter: "claude", nativeSessionId: "native-2", project: "/tmp/a" });
    const merged = dedupeDiscovered([external, hub, other]);
    expect(merged).toHaveLength(2);
    expect(merged.find((row) => row.nativeSessionId === "native-1")?.hubSessionId).toBe("hub-1");
  });

  it("keeps two sessions in one project when native ids differ", () => {
    const merged = dedupeDiscovered([
      item({ hubSessionId: "a", adapter: "claude", nativeSessionId: "1", project: "/tmp/same" }),
      item({ hubSessionId: "b", adapter: "claude", nativeSessionId: "2", project: "/tmp/same" }),
    ]);
    expect(merged).toHaveLength(2);
  });
});

describe("SessionManager.discover", () => {
  it("lists 20 hub sessions plus one external and one unsupported resume inside 10s, without duplicates", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uacc-disc-"));
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, { eventsPerSecond: 50, autoStopAfterEvents: 1 });
    const manager = new SessionManager(db, store, registry, new ProcessRunner());
    try {
      const created = [];
      for (let i = 0; i < 20; i++) {
        created.push(await manager.create({ adapter: "dummy", project: i % 2 === 0 ? "/tmp/alpha" : "/tmp/beta" }));
      }
      db.prepare("UPDATE sessions SET native_session_id = ? WHERE id = ?").run("native-shared", created[0]!.id);
      const t0 = performance.now();
      const page = await manager.discover(
        [
          {
            id: "external",
            list: async () => [
              item({
                hubSessionId: null,
                adapter: "dummy",
                nativeSessionId: "native-shared",
                project: "/tmp/alpha",
                controlMode: "observed",
              }),
              item({
                hubSessionId: null,
                adapter: "codex",
                nativeSessionId: "future",
                project: "/tmp/gamma",
                resumeVersion: 99,
                unsupportedResume: true,
                controlMode: "observed",
              }),
            ],
          },
        ],
        0,
        50,
      );
      expect(performance.now() - t0).toBeLessThan(10_000);
      expect(page.items).toHaveLength(21);
      expect(page.items.filter((row) => row.nativeSessionId === "native-shared")).toHaveLength(1);
      expect(page.items.find((row) => row.nativeSessionId === "native-shared")?.hubSessionId).toBe(created[0]!.id);
      expect(page.items.find((row) => row.resumeVersion === 99)?.unsupportedResume).toBe(true);
      const projects = new Set(page.items.map((row) => row.project));
      expect(projects.has("/tmp/alpha")).toBe(true);
      expect(projects.has("/tmp/beta")).toBe(true);
    } finally {
      await manager.shutdown();
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
