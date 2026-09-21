import { createHash } from "node:crypto";
import {
  MAX_EVENT_PAYLOAD_BYTES,
  NormalizedEvent,
  blobRefToString,
  type BlobRef,
} from "@uacc/contracts";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, readdir, rm, writeFile, type FileHandle } from "node:fs/promises";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";

/**
 * Append-only JSONL event store with blob offloading (ADR-P0-2, K5).
 *
 * Layout under dataDir:
 *   sessions/<sessionId>/events.jsonl   — canonical, one event per line
 *   sessions/<sessionId>/snapshot.json  — K7 restore point
 *   sessions/<sessionId>/blobs/<sha256> — offloaded large payloads
 *
 * Durability (premortem P0-3): batched fsync — flush at most every
 * FSYNC_INTERVAL_MS or every FSYNC_MAX_EVENTS events, whichever first.
 */
const FSYNC_INTERVAL_MS = 100;
const FSYNC_MAX_EVENTS = 50;
const PREVIEW_CHARS = 256;

interface PendingWrite {
  handle: FileHandle;
  count: number;
  timer?: NodeJS.Timeout;
}

export class EventStore {
  private readonly pending = new Map<string, PendingWrite>();
  private readonly seqCache = new Map<string, number>();
  /** Serializes appends per session — exactly one open FileHandle at a time. */
  private readonly appendChain = new Map<string, Promise<void>>();

  private readonly dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  /**
   * Readiness probe (ADR-0010): the sessions root must be creatable.
   * Does not write a fake session or touch JSONL.
   */
  async probe(): Promise<void> {
    await mkdir(join(this.dataDir, "sessions"), { recursive: true });
  }

  sessionDir(sessionId: string): string {
    return join(this.dataDir, "sessions", sessionId);
  }

  eventsPath(sessionId: string): string {
    return join(this.sessionDir(sessionId), "events.jsonl");
  }

  private blobDir(sessionId: string): string {
    return join(this.sessionDir(sessionId), "blobs");
  }

  async initSession(sessionId: string): Promise<void> {
    await mkdir(this.blobDir(sessionId), { recursive: true });
  }

  /**
   * Offload content to a blob, referenced by sha256. Deduplicated per session.
   */
  async writeBlob(sessionId: string, data: string | Uint8Array): Promise<BlobRef> {
    const buf = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
    const hash = createHash("sha256").update(buf).digest("hex");
    const dir = this.blobDir(sessionId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, hash), buf);
    return { hash, bytes: buf.byteLength, path: join("blobs", hash) };
  }

  async readBlob(sessionId: string, hash: string): Promise<Buffer> {
    return readFile(join(this.blobDir(sessionId), hash));
  }

  /**
   * Append events. Enforces K5: payloads serialized > 4 KB are offloaded to a
   * blob; the JSONL line keeps an anchor payload + blobRef. Events already
   * carrying a blobRef from ctx.blob() pass through untouched.
   */
  async append(sessionId: string, events: NormalizedEvent[]): Promise<NormalizedEvent[]> {
    if (events.length === 0) return events;
    const enforced: NormalizedEvent[] = [];
    for (const ev of events) {
      const raw = JSON.stringify(ev.payload ?? {});
      if (raw.length <= MAX_EVENT_PAYLOAD_BYTES || ev.blobRef) {
        enforced.push(ev);
        continue;
      }
      const blob = await this.writeBlob(sessionId, raw);
      enforced.push({
        ...ev,
        payload: {
          truncated: true,
          bytes: blob.bytes,
          preview: raw.slice(0, PREVIEW_CHARS),
        },
        blobRef: blobRefToString(blob),
      });
    }
    await this.appendLines(
      sessionId,
      enforced.map((e) => JSON.stringify(e)),
    );    const last = this.seqCache.get(sessionId);
    const lastEnforced = enforced[enforced.length - 1];
    if (lastEnforced && (last === undefined || lastEnforced.seq >= last)) {
      this.seqCache.set(sessionId, lastEnforced.seq);
    }
    return enforced;
  }

  /**
   * Runs `work` after everything already queued for this session — the one
   * lock appends, the debounce flush and explicit flush() all share, so a
   * flush can never close the FileHandle out from under a write that's
   * still in flight or already queued behind it (BUG-0003: an unserialized
   * flush closing the handle mid-write silently dropped the in-flight
   * event's `seq` forever — the K7 stream came back with a permanent gap).
   */
  private chain(sessionId: string, work: () => Promise<void>): Promise<void> {
    const prev = this.appendChain.get(sessionId) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(work);
    this.appendChain.set(sessionId, next);
    return next;
  }

  private appendLines(sessionId: string, lines: string[]): Promise<void> {
    return this.chain(sessionId, () => this.appendLinesLocked(sessionId, lines));
  }

  private async appendLinesLocked(sessionId: string, lines: string[]): Promise<void> {
    let entry = this.pending.get(sessionId);
    if (!entry) {
      const handle = await open(this.eventsPath(sessionId), "a");
      entry = { handle, count: 0 };
      this.pending.set(sessionId, entry);
    }
    const data = lines.map((l) => l + "\n").join("");
    await entry.handle.write(data);
    entry.count += lines.length;

    if (!entry.timer) {
      // Chained, not a bare `flush()` call: this fires on a real-time
      // timer, independent of the append serialization, so without
      // chaining it could interleave between two appends and close the
      // handle a concurrent write was about to use.
      entry.timer = setTimeout(() => void this.chain(sessionId, () => this.flushOne(sessionId)), FSYNC_INTERVAL_MS);
      entry.timer.unref();
    }
    // Already inside the chain here — call flushOne directly. Routing
    // through flush()/chain() again would await a promise that depends on
    // this very call, deadlocking.
    if (entry.count >= FSYNC_MAX_EVENTS) {
      await this.flushOne(sessionId);
    }
  }

  private async flushOne(sessionId: string): Promise<void> {
    const entry = this.pending.get(sessionId);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    await entry.handle.sync().catch(() => undefined);
    await entry.handle.close().catch(() => undefined);
    this.pending.delete(sessionId);
  }

  /** Force fsync of pending writes for one session (or all). Serialized
   * behind that session's appendChain — see chain(). */
  async flush(sessionId?: string): Promise<void> {
    const ids = sessionId ? [sessionId] : [...this.pending.keys()];
    await Promise.all(ids.map((id) => this.chain(id, () => this.flushOne(id))));
  }

  /** Full replay of a session stream (K7 restore). Skips torn/invalid lines. */
  async replay(sessionId: string): Promise<NormalizedEvent[]> {
    const events: NormalizedEvent[] = [];
    try {
      const rl = createInterface({ input: createReadStream(this.eventsPath(sessionId)), crlfDelay: Infinity });
      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          const parsed = NormalizedEvent.safeParse(JSON.parse(line));
          if (parsed.success) events.push(parsed.data);
        } catch {
          // torn write (kill -9) — line incomplete, skip
        }
      }
    } catch {
      return events;
    }
    return events;
  }

  /** Events after a given seq (pagination for resync + REST tail). */
  async tail(sessionId: string, afterSeq: number, limit = 500): Promise<NormalizedEvent[]> {
    const all = await this.replay(sessionId);
    return all.filter((e) => e.seq > afterSeq).slice(0, limit);
  }

  async lastSeq(sessionId: string): Promise<number> {
    const cached = this.seqCache.get(sessionId);
    if (cached !== undefined) return cached;
    const events = await this.replay(sessionId);
    const last = events.length > 0 ? events[events.length - 1]!.seq : 0;
    this.seqCache.set(sessionId, last);
    return last;
  }

  async saveSnapshot(sessionId: string, snapshot: unknown): Promise<void> {
    const dir = this.sessionDir(sessionId);
    await mkdir(dirname(this.eventsPath(sessionId)), { recursive: true });
    await writeFile(join(dir, "snapshot.json"), JSON.stringify(snapshot, null, 2));
  }

  async loadSnapshot<T>(sessionId: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(join(this.sessionDir(sessionId), "snapshot.json"), "utf8")) as T;
    } catch {
      return null;
    }
  }

  /** All session ids present on disk (recovery scan). */
  async listSessions(): Promise<string[]> {
    try {
      return (await readdir(join(this.dataDir, "sessions"))).filter(
        (d) => !d.startsWith("."),
      );
    } catch {
      return [];
    }
  }

  async destroySession(sessionId: string): Promise<void> {
    await this.flush(sessionId);
    await rm(this.sessionDir(sessionId), { recursive: true, force: true });
    this.seqCache.delete(sessionId);
  }
}
