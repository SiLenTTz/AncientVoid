import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DiscoveredSession } from "@ancientvoid/contracts";
import { EventStore, HubDatabase, SessionManager, AdapterRegistry } from "../../../src/index.ts";
import { dedupeDiscovered, filterDiscovered } from "../../../src/modules/discovery/dedupe.ts";
import { ProcessRunner } from "@ancientvoid/workers";
import { createAdapter as createDummy } from "@ancientvoid/adapter-dummy";

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
    parentSessionId: null,
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
  it("filters clip observers out — IDE chats carry no value in the list (user decision 2026-09-28); hub-managed ones stay", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-disc-noclip-"));
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registry.register("cursor-clip", createDummy, { eventsPerSecond: 50, autoStopAfterEvents: 1 });
    const manager = new SessionManager(db, store, registry, new ProcessRunner());
    try {
      const watched = await manager.create({ adapter: "cursor-clip", project: "/tmp/hub" });
      const page = await manager.discover(
        [
          {
            id: "extern",
            list: async () => [
              item({ hubSessionId: null, adapter: "cursor-clip", nativeSessionId: "cur-1", project: "/tmp/x", controlMode: "observed" }),
              item({ hubSessionId: null, adapter: "claude-clip", nativeSessionId: "cl-1", project: "/tmp/x", controlMode: "observed" }),
              item({ hubSessionId: null, adapter: "opencode", nativeSessionId: "oc-1", project: "/tmp/x", controlMode: "observed" }),
            ],
          },
        ],
        0,
        50,
      );
      expect(page.items).toHaveLength(2);
      expect(page.items.find((row) => row.hubSessionId === watched.id)).toBeTruthy();
      expect(page.items.map((row) => row.nativeSessionId)).toContain("oc-1");
      expect(page.items.some((row) => row.adapter === "cursor-clip" && row.controlMode === "observed")).toBe(false);
      expect(page.items.some((row) => row.adapter === "claude-clip")).toBe(false);
    } finally {
      await manager.shutdown();
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("BUG-0035: leads with the most recently observed — page 1 shows what runs now", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-disc-sort-"));
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, { eventsPerSecond: 50, autoStopAfterEvents: 1 });
    const manager = new SessionManager(db, store, registry, new ProcessRunner());
    try {
      const hub = await manager.create({ adapter: "dummy", project: "/tmp/hub" });
      db.prepare("UPDATE sessions SET observed_at = ? WHERE id = ?").run("2026-09-28T10:00:00.000Z", hub.id);
      const page = await manager.discover(
        [
          {
            id: "external",
            // oldest first, as the source's DB scan yields it
            list: async () => [
              item({ hubSessionId: null, adapter: "opencode", nativeSessionId: "alt", project: "/tmp/alt", controlMode: "observed", observedAt: "2026-09-24T00:00:00.000Z" }),
              item({ hubSessionId: null, adapter: "opencode", nativeSessionId: "jetzt", project: "/tmp/jetzt", controlMode: "observed", observedAt: "2026-09-28T12:00:00.000Z" }),
            ],
          },
        ],
        0,
        2,
      );
      // newest first: the 12:00 external observation, then the hub row
      // (10:00) — the Sep-24 session only makes page 2.
      expect(page.items.map((row) => row.nativeSessionId)).toEqual(["jetzt", null]);
      expect(page.items[1]!.hubSessionId).toBe(hub.id);
      expect(page.nextCursor).toBe(2);
    } finally {
      await manager.shutdown();
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("lists 20 hub sessions plus one external and one unsupported resume inside 10s, without duplicates", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-disc-"));
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

describe("Titel und Suche (ADR-0040)", () => {
  it("der Hub-Eintrag gewinnt, leiht sich aber Titel, Vorschau und live vom externen Fund", () => {
    const hub = item({ hubSessionId: "hub-1", adapter: "claude", nativeSessionId: "n-1", title: null });
    const external = item({ hubSessionId: null, adapter: "claude", nativeSessionId: "n-1", title: "Session-Abbrüche", preview: "Mach weiter", live: true });
    const [merged, ...rest] = dedupeDiscovered([external, hub]);
    expect(rest).toHaveLength(0);
    expect(merged).toMatchObject({ hubSessionId: "hub-1", title: "Session-Abbrüche", preview: "Mach weiter", live: true });
  });

  it("ein fehlgeschlagener Hub-Eintrag (error) verdeckt die externe Session nicht", () => {
    const failed = item({ hubSessionId: "hub-x", adapter: "claude", nativeSessionId: "n-9", status: "error" });
    const external = item({ hubSessionId: null, adapter: "claude", nativeSessionId: "n-9", status: "observed", controlMode: "observed", title: "Noch da" });
    const merged = dedupeDiscovered([failed, external]);
    expect(merged.map((m) => m.hubSessionId)).toEqual(["hub-x", null]);
  });

  it("filterDiscovered sucht in Titel, Vorschau, Projekt und ID, alle Wörter müssen passen", () => {
    const a = item({ hubSessionId: null, adapter: "claude", nativeSessionId: "aaa", title: "Login umbauen", preview: "teste den Token", project: "/x/AncientVoid" });
    const b = item({ hubSessionId: null, adapter: "opencode", nativeSessionId: "bbb", title: "Doku", project: "/x/andere" });
    expect(filterDiscovered([a, b], { q: "login token" })).toEqual([a]);
    expect(filterDiscovered([a, b], { q: "ANCIENTVOID" })).toEqual([a]);
    expect(filterDiscovered([a, b], { q: "bbb" })).toEqual([b]);
    expect(filterDiscovered([a, b], { adapter: "opencode" })).toEqual([b]);
    expect(filterDiscovered([a, b], {})).toEqual([a, b]);
    expect(filterDiscovered([a, b], { q: "gibtsnicht" })).toEqual([]);
  });
});
