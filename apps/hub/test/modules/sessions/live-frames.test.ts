import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WebSocket } from "ws";
import { EventStore, SessionManager, AdapterRegistry, HubDatabase } from "@ancientvoid/core";
import { ProcessRunner } from "@ancientvoid/workers";
import { createAdapter as createDummy } from "@ancientvoid/adapter-dummy";
import type { Adapter, AdapterContext, SessionSpec } from "@ancientvoid/contracts";
import { createTailHandler } from "../../../src/modules/sessions/ws.ts";

/**
 * BUG-0178 / ADR-0083: echtes Streaming darf keine erfundene Geschichte sein.
 * Bewiesen wird hier beides: (1) die Frames kommen beim Client an, (2) sie werden
 * NICHT persistiert — der Block bleibt das einzige dauerhafte Ereignis (K5/K7).
 */
function fakeSocket() {
  const sent: unknown[] = [];
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  const socket = {
    readyState: 1,
    OPEN: 1,
    bufferedAmount: 0,
    send: (data: string) => sent.push(JSON.parse(data)),
    close: () => undefined,
    on: (event: string, cb: (...args: unknown[]) => void) => handlers.set(event, [...(handlers.get(event) ?? []), cb]),
    emit: (event: string, ...args: unknown[]) => (handlers.get(event) ?? []).forEach((cb) => cb(...args)),
  };
  return { socket: socket as unknown as WebSocket, sent };
}

function withOneBadFrame(inner: Adapter): Adapter {
  return {
    ...inner,
    start: async (spec: SessionSpec, ctx: AdapterContext) => {
      ctx.stream?.({ turnId: "kaputt", stream: "assistant", seq: 0, text: "", final: true });
      ctx.stream?.({ turnId: "kaputt", stream: "erfunden" as "assistant", seq: 0, text: "x", final: true });
      return inner.start(spec, ctx);
    },
  };
}

async function setup(opts: { liveFrames: boolean; bad?: boolean }) {
  const dir = await mkdtemp(join(tmpdir(), "ancientvoid-frames-"));
  const db = new HubDatabase(":memory:");
  const store = new EventStore(dir);
  const registry = new AdapterRegistry();
  const config = { liveFrames: opts.liveFrames, eventsPerSecond: 40, autoStopAfterEvents: 6, giantEvery: 0 };
  registry.register("dummy", opts.bad ? (c: Readonly<Record<string, unknown> | undefined>) => withOneBadFrame(createDummy(c)) : createDummy, config);
  const sessions = new SessionManager(db, store, registry, new ProcessRunner());
  const record = await sessions.create({ adapter: "dummy", project: dir });
  return { sessions, record, cleanup: async () => { await sessions.shutdown(); await rm(dir, { recursive: true, force: true }); } };
}

describe("Live-Frames im Hub (BUG-0178, ADR-0083)", () => {
  it("Frames erreichen den Client am ws-Tail", async () => {
    const { sessions, record, cleanup } = await setup({ liveFrames: true });
    try {
      const { socket, sent } = fakeSocket();
      createTailHandler(sessions)(socket, { params: { id: record.id } });
      await new Promise((r) => setTimeout(r, 600));
      const frameMsgs = sent.filter((m) => (m as { type?: string }).type === "stream") as {
        sessionId: string;
        frames: { text: string; seq: number; final: boolean; stream: string }[];
      }[];
      expect(frameMsgs.length).toBeGreaterThan(0);
      expect(frameMsgs[0]!.sessionId).toBe(record.id);
      const all = frameMsgs.flatMap((m) => m.frames);
      expect(all.some((f) => f.stream === "assistant" && f.final)).toBe(true);
      expect(all.every((f) => f.text.length > 0)).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it("Frames werden NICHT persistiert — der Block bleibt das einzige Ereignis", async () => {
    const { sessions, record, cleanup } = await setup({ liveFrames: true });
    try {
      const { socket, sent } = fakeSocket();
      createTailHandler(sessions)(socket, { params: { id: record.id } });
      await new Promise((r) => setTimeout(r, 600));
      const stored = await sessions.tail(record.id, 0, 200);
      const assistant = stored.filter((e) => e.type === "assistant");
      expect(assistant.length).toBeGreaterThan(0);
      // Kein einziges Ereignis traegt Frame-Text als eigenen Payload-Wert.
      const frameTexts = sent
        .filter((m) => (m as { type?: string }).type === "stream")
        .flatMap((m) => (m as { frames: { text: string }[] }).frames.map((f) => f.text));
      expect(frameTexts.length).toBeGreaterThan(0);
      for (const text of frameTexts) {
        expect(stored.some((e) => JSON.stringify(e.payload) === JSON.stringify(text))).toBe(false);
      }
      // Der Block traegt den vollen Text (Frame 1 + Frame 2), nicht nur einen Teil.
      const withText = assistant.filter((e) => JSON.stringify(e.payload).includes("dummy assistant"));
      expect(withText.length).toBe(assistant.length);
    } finally {
      await cleanup();
    }
  });

  it("ein kaputter Frame wird abgelehnt, ohne die Session zu stoeren", async () => {
    const { sessions, record, cleanup } = await setup({ liveFrames: true, bad: true });
    try {
      const { socket, sent } = fakeSocket();
      createTailHandler(sessions)(socket, { params: { id: record.id } });
      await new Promise((r) => setTimeout(r, 600));
      const all = sent
        .filter((m) => (m as { type?: string }).type === "stream")
        .flatMap((m) => (m as { frames: { text: string; stream: string; turnId: string }[] }).frames);
      expect(all.some((f) => f.turnId === "kaputt")).toBe(false); // leerer Text und Fremd-Stream kamen nie raus
      expect(all.length).toBeGreaterThan(0); // die guten Frames schon
      const stored = await sessions.tail(record.id, 0, 200);
      expect(stored.some((e) => e.type === "assistant")).toBe(true); // Session lief normal weiter
    } finally {
      await cleanup();
    }
  });

  it("ohne liveFrames sendet der Dummy keine Frames (nichts wird vorgetaeuscht)", async () => {
    const { sessions, record, cleanup } = await setup({ liveFrames: false });
    try {
      const { socket, sent } = fakeSocket();
      createTailHandler(sessions)(socket, { params: { id: record.id } });
      await new Promise((r) => setTimeout(r, 600));
      expect(sent.some((m) => (m as { type?: string }).type === "stream")).toBe(false);
      expect(sent.some((m) => (m as { type?: string }).type === "events")).toBe(true);
    } finally {
      await cleanup();
    }
  });
});
