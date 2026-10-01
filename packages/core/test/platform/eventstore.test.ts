import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fc from "fast-check";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStore } from "../../src/platform/eventstore.ts";
import { EVENT_TYPES, type NormalizedEvent } from "@uacc/contracts";

function ev(seq: number, payload: Record<string, unknown> = {}): NormalizedEvent {
  return {
    seq,
    ts: new Date().toISOString(),
    sessionId: "s1",
    type: "assistant",
    summary: `event ${seq}`,
    payload,
    blobRef: null,
  };
}

describe("EventStore", () => {
  let dir: string;
  let store: EventStore;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "uacc-test-"));
    store = new EventStore(dir);
    await store.initSession("s1");
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("appends and replays events", async () => {
    await store.append("s1", [ev(1), ev(2), ev(3)]);
    await store.flush("s1");
    const replayed = await store.replay("s1");
    expect(replayed.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(replayed[0]!.summary).toBe("event 1");
  });

  it("enforces K5: payload > 4 KB is offloaded to a blob, anchor stays small", async () => {
    const huge = { data: "x".repeat(64 * 1024) };
    const [enforced] = await store.append("s1", [ev(4, huge)]);
    await store.flush("s1");
    expect(enforced!.blobRef).toMatch(/^sha256:[a-f0-9]{64}$/);
    const line = (await readFile(join(dir, "sessions", "s1", "events.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .pop()!;
    expect(line.length).toBeLessThan(4096);
    const payload = JSON.parse(line).payload as { truncated: boolean; bytes: number };
    expect(payload.truncated).toBe(true);
    expect(payload.bytes).toBeGreaterThan(64 * 1024);
    // Blob is retrievable and byte-identical (AC-P0-2).
    const blob = await store.readBlob("s1", enforced!.blobRef!.slice("sha256:".length));
    expect(JSON.parse(blob.toString())).toEqual(huge);
  });

  it("T2.9 (K5 property test): every real event type stays ≤4KB on disk, blob round-trips byte-identical, regardless of payload shape/size", async () => {
    // "über alle Event-Typen" — EVENT_TYPES from @uacc/contracts, not a
    // hand-picked subset, so a ninth type added later is covered for
    // free. fast-check explores payload shape/size per type; each run
    // gets its own session so seq/offloading from one run can't leak
    // into another's assertions.
    let n = 0;
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...EVENT_TYPES),
        fc.oneof(
          fc.dictionary(fc.string(), fc.string({ maxLength: 200 })),
          fc.record({ data: fc.string({ minLength: 0, maxLength: 20_000 }) }),
          fc.array(fc.string({ maxLength: 500 }), { maxLength: 50 }).map((items) => ({ items })),
        ),
        async (type, payload) => {
          const sessionId = `k5-prop-${n++}`;
          await store.initSession(sessionId);
          const [enforced] = await store.append(sessionId, [
            { seq: 1, ts: new Date().toISOString(), sessionId, type, summary: `prop ${type}`, payload, blobRef: null },
          ]);
          await store.flush(sessionId);
          const line = (await readFile(join(dir, "sessions", sessionId, "events.jsonl"), "utf8")).trim();
          expect(line.length).toBeLessThan(4096);
          const serializedPayloadBytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
          if (serializedPayloadBytes > 4096) {
            expect(enforced!.blobRef).toMatch(/^sha256:[a-f0-9]{64}$/);
            const blob = await store.readBlob(sessionId, enforced!.blobRef!.slice("sha256:".length));
            expect(JSON.parse(blob.toString())).toEqual(payload);
          } else {
            expect(enforced!.blobRef).toBeNull();
            expect(enforced!.payload).toEqual(payload);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it("tails after a seq", async () => {
    await store.append("s1", [ev(5), ev(6)]);
    await store.flush("s1");
    const tail = await store.tail("s1", 4, 10);
    expect(tail.map((e) => e.seq)).toEqual([5, 6]);
  });

  it("reports lastSeq", async () => {
    expect(await store.lastSeq("s1")).toBe(6);
  });

  it("survives hard restart (new instance replays from disk)", async () => {
    const reopened = new EventStore(dir);
    const replayed = await reopened.replay("s1");
    expect(replayed.length).toBe(6);
    expect(await reopened.lastSeq("s1")).toBe(6);
  });

  it("snapshots round-trip", async () => {
    await store.saveSnapshot("s1", { status: "working", lastSeq: 6 });
    const snap = await store.loadSnapshot<{ status: string }>("s1");
    expect(snap?.status).toBe("working");
  });

  it("handles corrupt trailing lines without losing earlier events", async () => {
    // Simulate a torn write from kill -9.
    await store.flush("s1");
    await writeFile(
      join(dir, "sessions", "s1", "events.jsonl"),
      Buffer.concat([
        Buffer.from(await readFile(join(dir, "sessions", "s1", "events.jsonl"))),
        Buffer.from('{"seq":7,"partial'),
      ]),
    );
    const replayed = await store.replay("s1");
    expect(replayed.length).toBe(6);
  });

  it("collects session-local blobs when a session is explicitly destroyed", async () => {
    await store.initSession("gc-session");
    const blob = await store.writeBlob("gc-session", "session data");
    await store.destroySession("gc-session");
    await expect(store.readBlob("gc-session", blob.hash)).rejects.toThrow();
    await expect(readFile(join(dir, "sessions", "gc-session", "events.jsonl"))).rejects.toThrow();
  });
});
