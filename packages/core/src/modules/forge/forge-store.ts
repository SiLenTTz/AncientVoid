import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ForgeLink, ForgeMrRef, ForgeOperation } from "@ancientvoid/contracts";

/**
 * EPIC-P37 / ADR-0056 §7: Verknüpfungen und Operationen aus Journal + Snapshot
 * pro Session (P36-ReviewStore-Muster, K7). Das Journal hält die Verknüpfung
 * und die Operationshistorie — die externe Wahrheit (MR-Zustand, SHA, CI)
 * wird nach jedem Neustart neu geprüft, nie aus dem Cache geglaubt.
 */

type JournalEvent =
  | { seq: number; type: "mr_linked"; at: string; mr: ForgeMrRef }
  | { seq: number; type: "mr_unlinked"; at: string }
  | { seq: number; type: "mr_fetched"; at: string; sha: string | null }
  | {
      seq: number;
      type: "feedback_sent";
      at: string;
      operationId: string;
      ok: boolean;
      detail: string | null;
      sha: string | null;
      pipelineId: number | null;
      jobId: number | null;
    }
  | { seq: number; type: "draft_mr"; at: string; operation: ForgeOperation };

/** Omit über eine Union muss verteilen, sonst kollabiert es auf die Gemeinsamkeiten. */
type WithoutSeq<T> = T extends unknown ? Omit<T, "seq"> : never;

interface Snapshot {
  appliedSeq: number;
  link: ForgeLink | null;
  operations: ForgeOperation[];
}

interface SessionState {
  link: ForgeLink | null;
  operations: Map<string, ForgeOperation>;
  seq: number;
  skippedLines: number;
}

export class ForgeStore {
  private readonly root: string;
  private readonly sessions = new Map<string, SessionState>();

  constructor(root: string) {
    this.root = root;
  }

  private load(sessionId: string): SessionState {
    const cached = this.sessions.get(sessionId);
    if (cached) return cached;
    const dir = resolve(this.root, sessionId);
    let snapshot: Snapshot = { appliedSeq: 0, link: null, operations: [] };
    if (existsSync(resolve(dir, "snapshot.json"))) {
      try {
        const parsed = JSON.parse(readFileSync(resolve(dir, "snapshot.json"), "utf8")) as Snapshot;
        if (typeof parsed.appliedSeq === "number") snapshot = { appliedSeq: parsed.appliedSeq, link: parsed.link ?? null, operations: Array.isArray(parsed.operations) ? parsed.operations : [] };
      } catch {
        snapshot = { appliedSeq: 0, link: null, operations: [] };
      }
    }
    const link: ForgeLink | null = snapshot.link
      ? { ...snapshot.link, sessionId }
      : null;
    const operations = new Map(snapshot.operations.map((o) => [o.id, o]));
    let seq = snapshot.appliedSeq;
    let skipped = 0;
    const journalPath = resolve(dir, "journal.jsonl");
    if (existsSync(journalPath)) {
      for (const line of readFileSync(journalPath, "utf8").split("\n")) {
        if (!line.trim()) continue;
        let event: JournalEvent;
        try {
          event = JSON.parse(line) as JournalEvent;
        } catch {
          skipped += 1;
          continue;
        }
        if (typeof event.seq !== "number" || event.seq <= snapshot.appliedSeq) continue;
        this.apply({ link, operations }, event);
        seq = Math.max(seq, event.seq);
      }
    }
    const state: SessionState = { link, operations, seq, skippedLines: skipped };
    this.sessions.set(sessionId, state);
    return state;
  }

  private apply(state: { link: ForgeLink | null; operations: Map<string, ForgeOperation> }, event: JournalEvent): void {
    switch (event.type) {
      case "mr_linked":
        state.link = {
          sessionId: "",
          mr: event.mr,
          lastSha: null,
          lastFetchedAt: null,
          createdAt: event.at,
        };
        break;
      case "mr_unlinked":
        state.link = null;
        break;
      case "mr_fetched":
        if (state.link) state.link = { ...state.link, lastSha: event.sha, lastFetchedAt: event.at };
        break;
      case "feedback_sent": {
        const existing = state.operations.get(event.operationId);
        const op: ForgeOperation = {
          id: event.operationId,
          kind: "feedback_send",
          state: event.ok ? "done" : "failed",
          sha: event.sha,
          pipelineId: event.pipelineId,
          jobId: event.jobId,
          detail: event.detail,
          createdAt: existing?.createdAt ?? event.at,
          updatedAt: event.at,
        };
        state.operations.set(op.id, op);
        break;
      }
      case "draft_mr": {
        // ältere Zustände dürfen nicht rückwärts laufen (done bleibt done)
        const existing = state.operations.get(event.operation.id);
        if (existing?.state === "done" && event.operation.state !== "done") break;
        state.operations.set(event.operation.id, event.operation);
        break;
      }
    }
  }

  private commit(sessionId: string, event: WithoutSeq<JournalEvent>): void {
    const state = this.load(sessionId);
    const dir = resolve(this.root, sessionId);
    mkdirSync(dir, { recursive: true });
    state.seq += 1;
    const withSeq = { ...event, seq: state.seq } as JournalEvent;
    this.apply(state, withSeq);
    writeFileSync(resolve(dir, "journal.jsonl"), JSON.stringify(withSeq) + "\n", { flag: "a" });
    const snapshot: Snapshot = {
      appliedSeq: state.seq,
      link: state.link ? { ...state.link, sessionId } : null,
      operations: [...state.operations.values()],
    };
    const tmp = resolve(dir, "snapshot.json.tmp");
    writeFileSync(tmp, JSON.stringify(snapshot));
    renameSync(tmp, resolve(dir, "snapshot.json"));
  }

  getLink(sessionId: string): ForgeLink | null {
    return this.load(sessionId).link;
  }

  linkMr(sessionId: string, mr: ForgeMrRef): ForgeLink {
    this.commit(sessionId, { type: "mr_linked", at: new Date().toISOString(), mr });
    return this.getLink(sessionId)!;
  }

  unlinkMr(sessionId: string): boolean {
    if (!this.getLink(sessionId)) return false;
    this.commit(sessionId, { type: "mr_unlinked", at: new Date().toISOString() });
    return true;
  }

  /** Letzter Abruf (SHA/Zeitstempel) — Grundlage der Drift-Markierung. */
  recordFetch(sessionId: string, sha: string | null): void {
    if (!this.getLink(sessionId)) return;
    this.commit(sessionId, { type: "mr_fetched", at: new Date().toISOString(), sha });
  }

  private writeSnapshot(sessionId: string, state: SessionState): void {
    const dir = resolve(this.root, sessionId);
    mkdirSync(dir, { recursive: true });
    const snapshot: Snapshot = {
      appliedSeq: state.seq,
      link: state.link ? { ...state.link, sessionId } : null,
      operations: [...state.operations.values()],
    };
    const tmp = resolve(dir, "snapshot.json.tmp");
    writeFileSync(tmp, JSON.stringify(snapshot));
    renameSync(tmp, resolve(dir, "snapshot.json"));
  }

  listOperations(sessionId: string): ForgeOperation[] {
    return [...this.load(sessionId).operations.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  getOperation(sessionId: string, id: string): ForgeOperation | undefined {
    return this.load(sessionId).operations.get(id);
  }

  recordFeedback(
    sessionId: string,
    entry: { operationId: string; ok: boolean; detail: string | null; sha: string | null; pipelineId: number | null; jobId: number | null },
  ): void {
    this.commit(sessionId, {
      type: "feedback_sent",
      at: new Date().toISOString(),
      operationId: entry.operationId,
      ok: entry.ok,
      detail: entry.detail,
      sha: entry.sha,
      pipelineId: entry.pipelineId,
      jobId: entry.jobId,
    });
  }

  /** Draft-MR-Operation anlegen bzw. fortschreiben (pending → done/failed/uncertain). */
  recordDraftMr(sessionId: string, operation: Omit<ForgeOperation, "createdAt" | "updatedAt"> & { createdAt?: string }): ForgeOperation {
    const existing = this.getOperation(sessionId, operation.id);
    const full: ForgeOperation = {
      ...operation,
      createdAt: operation.createdAt ?? existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.commit(sessionId, { type: "draft_mr", at: full.updatedAt, operation: full });
    return this.getOperation(sessionId, operation.id)!;
  }

  skippedLines(sessionId: string): number {
    return this.load(sessionId).skippedLines;
  }

  /** Test-Hook: Speicher verwerfen (nächstes load() liest neu). */
  reloadForTest(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}
