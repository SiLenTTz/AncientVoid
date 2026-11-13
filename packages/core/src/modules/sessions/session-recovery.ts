import type { AdapterResume, NormalizedEvent, Ack } from "@ancientvoid/contracts";
import type { LiveSession } from "./session-state.ts";

interface Host {
  error(err: unknown): void;
  events(id: string): Promise<NormalizedEvent[]>;
  declaration(id: string): AdapterResume | undefined;
  emit(session: LiveSession, kind: string, payload: Record<string, unknown>): Promise<void>;
  resume(session: LiveSession): Promise<Ack>;
}

/** ADR-0074: bounded recovery through the existing input queue, never recursive. */
export class SessionRecovery {
  private readonly host: Host;
  private readonly pending = new Map<string, NodeJS.Timeout>();
  private readonly running = new Set<string>();
  private closed = false;
  constructor(host: Host) { this.host = host; }

  schedule(session: LiveSession): void {
    const id = session.record.id;
    if (this.closed || this.pending.has(id) || this.running.has(id) || session.record.status !== "interrupted") return;
    const timer = setTimeout(() => {
      this.pending.delete(id);
      this.running.add(id);
      void this.attempt(session).catch(async (err: unknown) => {
        await this.host.emit(session, "session.recovery_blocked", { detail: String(err).slice(0, 500) });
      }).finally(() => this.running.delete(id)).catch(err => this.host.error(err));
    }, 250);
    timer.unref();
    this.pending.set(id, timer);
  }

  close(): void {
    this.closed = true;
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
  }

  private async attempt(session: LiveSession): Promise<void> {
    if (this.closed || session.record.status !== "interrupted") return;
    const events = await this.host.events(session.record.id);
    if (this.closed) return;
    const interrupt = events.findLast(e => e.payload.kind === "session.interrupted");
    if (interrupt?.payload.autoResumeEligible !== true) return;
    const after = events.filter(e => e.seq > interrupt.seq);
    if (after.some(e => e.payload.kind === "session.recovery_blocked")) return;
    const declaration = this.host.declaration(session.record.adapter);
    let detail: string | undefined;
    if (!declaration?.auto || !declaration.hub || declaration.ref !== "native" || !session.record.nativeSessionId) {
      detail = "Automatische Fortsetzung nicht verfügbar — native Session oder Adapter-Unterstützung fehlt.";
    } else if ([...(session.activities?.values() ?? [])].some(a => a.external)) {
      detail = "Externe Hintergrundarbeit ist noch offen — vor einer Fortsetzung prüfen, damit keine doppelte Arbeit startet.";
    }
    const boundary = events.findLastIndex(e => e.payload.kind === "session.prompt" || (e.payload.kind === "session.turn_end" && e.payload.code === 0 && !e.payload.reason));
    const attempts = events.slice(boundary + 1).filter(e => e.payload.kind === "session.auto_resume_attempt").length;
    if (attempts >= 3) detail = "Drei Wiederanläufe ohne erfolgreichen Zugabschluss — bitte abbrechen oder an eine andere Session übergeben.";
    if (detail) {
      await this.host.emit(session, "session.recovery_blocked", { detail });
      return;
    }
    await this.host.emit(session, "session.auto_resume_attempt", { attempt: attempts + 1, interruptionSeq: interrupt.seq });
    const ack = await this.host.resume(session);
    if (!ack.ok && !this.closed && !["stopped", "parked"].includes(session.record.status)) {
      await this.host.emit(session, "session.recovery_blocked", { detail: ack.detail ?? "Wiederaufnahme fehlgeschlagen — bitte abbrechen oder übergeben." });
    }
  }
}
