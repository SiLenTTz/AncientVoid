import type { Ack, NormalizedEvent, SessionInterruptionPayload, SessionInterruptionReason } from "@ancientvoid/contracts";
import type { LiveSession } from "./session-state.ts";

interface Host {
  replay(id: string): Promise<NormalizedEvent[]>;
  setStatus(session: LiveSession, status: "interrupted" | "error"): Promise<void>;
  emit(session: LiveSession, kind: string, payload: Record<string, unknown>): Promise<void>;
  digest(session: LiveSession): void;
  stop(session: LiveSession): Promise<void>;
  autoResume(session: LiveSession): Promise<Ack>;
}

/** All interruption evidence comes from the journal; no additional durable state. */
export class SessionInterruption {
  private readonly pending = new Map<string, Promise<void>>();
  private readonly host: Host;
  constructor(host: Host) { this.host = host; }

  interrupt(session: LiveSession, reason: SessionInterruptionReason): Promise<void> {
    const id = session.record.id;
    const previous = this.pending.get(id);
    if (previous) return previous;
    const run = this.record(session, reason).finally(() => this.pending.delete(id));
    this.pending.set(id, run);
    return run.then(async () => {
      if (session.record.status === "interrupted") await this.host.autoResume(session);
    });
  }

  settled(id: string): Promise<void> { return this.pending.get(id) ?? Promise.resolve(); }

  /** Complete a journal boundary if the hub died between status and turn_end. */
  async repair(session: LiveSession): Promise<void> {
    const events = await this.host.replay(session.record.id);
    const interrupted = events.findLast(e => e.payload.kind === "session.interrupted");
    const end = events.findLast(e => e.payload.kind === "session.turn_end");
    const start = events.findLast(e => e.payload.kind === "session.prompt" || e.payload.kind === "session.resumed" || e.payload.kind === "session.created");
    const current = interrupted && (!start || interrupted.seq > start.seq) ? interrupted : undefined;
    if (current && end && end.seq > current.seq) return;
    if (!current) await this.host.emit(session, "session.interrupted", {
      reason: "hub_restart", since: session.record.updatedAt, lastTurnId: start ? String(start.seq) : null,
    });
    await this.host.emit(session, "session.turn_end", { code: null, reason: "interrupted" });
    this.host.digest(session);
  }

  private async record(session: LiveSession, reason: SessionInterruptionReason): Promise<void> {
    if (!["working", "starting", "waiting_approval"].includes(session.record.status)) return;
    const events = await this.host.replay(session.record.id);
    // Der abgeschnittene Zug beginnt mit dem ERSTEN prompt/resumed nach dem
    // letzten turn_end. Menschliche Folgeprompts, die noch in dem offenen Zug
    // eingingen (steer/Queue, P27), verschieben diese Grenze nicht — sonst
    // würde ein Fehler-Exit durch schnelle Folgeeingaben zu „interrupted“
    // statt „error“ (BUG-0095, CI-Lauf 3034339525). Ein vorheriger fehlge-
    // schlagener Zug bleibt hinter seinem turn_end unsichtbar (P27-Regel).
    const lastEnd = events.findLastIndex(e => e.payload.kind === "session.turn_end");
    const boundary = events.findIndex((e, i) => i > lastEnd && (e.payload.kind === "session.prompt" || e.payload.kind === "session.resumed"));
    const failures = events.slice(Math.max(0, boundary)).filter(e => e.type === "error" || e.payload.kind === "provider.error" || e.payload.kind === "cursor.usage_limit" || (e.payload.kind === "session.activity" && e.payload.external === true && (e.payload.activity as { state?: string } | undefined)?.state === "failed"));
    const failed = failures.some(e => e.payload.category !== "network" && e.payload.category !== "server");
    // A stop/park can have won while replay was in flight.
    if (!["working", "starting", "waiting_approval"].includes(session.record.status)) return;
    await this.host.setStatus(session, failed ? "error" : "interrupted");
    session.abort.abort();
    if (!failed) {
      const lastPrompt = events.findLast(e => e.payload.kind === "session.prompt");
      const payload: SessionInterruptionPayload = {
        kind: "session.interrupted", reason, since: new Date().toISOString(), lastTurnId: lastPrompt ? String(lastPrompt.seq) : null,
      };
      await this.host.emit(session, payload.kind, { ...payload, autoResumeEligible: true });
    }
    await this.host.emit(session, "session.turn_end", { code: null, reason: failed ? "error" : "interrupted" });
    this.host.digest(session);
    // Stop stale transports before giving a resume a fresh context.
    try {
      if (session.handle) await this.host.stop(session);
    } catch (err) {
      await this.host.setStatus(session, "error");
      await this.host.emit(session, "session.interrupt_cleanup_failed", { detail: String(err).slice(0, 1000) });
      return;
    }
    session.handle = null;
    session.activeWorkers = 0;
    session.persistentWorker = false;
  }
}
