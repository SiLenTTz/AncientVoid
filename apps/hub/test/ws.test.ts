import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WebSocket } from "ws";
import { EventStore, SessionManager, AdapterRegistry, HubDatabase } from "@uacc/core";
import { ProcessRunner } from "@uacc/workers";
import { createAdapter as createDummy } from "@uacc/adapter-dummy";
import { createTailHandler } from "../src/ws.ts";

/**
 * BUG-0007 regression: a real Playwright + CDP-throttled run proved
 * `dropped:true` never fired under a slow real network, because the
 * in-process buffer never overflows when `socket.send()` returns
 * immediately regardless of actual transport speed. Reproducing that with
 * a real throttled socket in CI would be non-deterministic (network timing
 * is not controllable there); this fakes only the transport boundary
 * (`socket.bufferedAmount`) — the session, adapter and event pipeline
 * beneath it are real.
 */
function fakeSocket() {
  const sent: unknown[] = [];
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  const mutable = {
    readyState: 1,
    OPEN: 1,
    bufferedAmount: 0,
    send: (data: string) => sent.push(JSON.parse(data)),
    close: () => undefined,
    on: (event: string, cb: (...args: unknown[]) => void) => {
      const list = handlers.get(event) ?? [];
      list.push(cb);
      handlers.set(event, list);
    },
  };
  return { socket: mutable as unknown as WebSocket, mutable, sent };
}

describe("ws.ts createTailHandler — BUG-0007 network-aware drop-on-slow", () => {
  async function setup() {
    const dir = await mkdtemp(join(tmpdir(), "uacc-ws-"));
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, { eventsPerSecond: 100, autoStopAfterEvents: 0, giantEvery: 0 });
    const sessions = new SessionManager(db, store, registry, new ProcessRunner());
    const record = await sessions.create({ adapter: "dummy", project: dir });
    return {
      sessions,
      record,
      cleanup: async () => {
        await sessions.shutdown();
        await rm(dir, { recursive: true, force: true });
      },
    };
  }

  it("flags dropped:true when the socket can't drain (bufferedAmount over threshold), even with few in-process events", async () => {
    const { sessions, record, cleanup } = await setup();
    try {
      const { socket, mutable, sent } = fakeSocket();
      // Simulate an already-congested transport (e.g. a throttled real
      // network) from the very first byte, unlike the in-process count
      // cap which needs >100 queued events to ever trigger. A real socket
      // eventually drains its queued bytes over time even under
      // congestion — modeled here by resetting bufferedAmount back down
      // after a short window, so the collapsed+flagged batch gets sent
      // once the "network" catches up.
      mutable.bufferedAmount = 1_000_000;
      setTimeout(() => {
        mutable.bufferedAmount = 0;
      }, 100);
      const handler = createTailHandler(sessions);
      handler(socket, { params: { id: record.id } });

      await new Promise((r) => setTimeout(r, 400));

      const eventsMsgs = sent.filter((m) => (m as { type?: string }).type === "events");
      expect(eventsMsgs.length).toBeGreaterThan(0);
      expect(eventsMsgs.some((m) => (m as { dropped?: boolean }).dropped === true)).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it("does not flag dropped:true when the socket drains normally (bufferedAmount stays 0)", async () => {
    const { sessions, record, cleanup } = await setup();
    try {
      const { socket, sent } = fakeSocket();
      const handler = createTailHandler(sessions);
      handler(socket, { params: { id: record.id } });

      await new Promise((r) => setTimeout(r, 300));

      const eventsMsgs = sent.filter((m) => (m as { type?: string }).type === "events");
      expect(eventsMsgs.length).toBeGreaterThan(0);
      expect(eventsMsgs.every((m) => (m as { dropped?: boolean }).dropped === false)).toBe(true);
    } finally {
      await cleanup();
    }
  });
});
