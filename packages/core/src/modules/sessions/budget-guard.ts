import type { Ack, AdapterContext, SessionRecord, SessionStatus } from "@uacc/contracts";
import type { LiveSession } from "./session-state.ts";

/** What the budget guard may do with sessions — nothing more (ADR-0020). */
export interface BudgetHost {
  session(id: string): LiveSession | undefined;
  sessions(): Iterable<LiveSession>;
  records(): SessionRecord[];
  emitSystem(session: LiveSession, kind: string, payload: Record<string, unknown>): Promise<void>;
  park(session: LiveSession, reason: SessionRecord["parkReason"], actor?: string): Promise<void>;
  setStatus(session: LiveSession, status: SessionStatus): Promise<void>;
  context(session: LiveSession): AdapterContext;
  persist(record: SessionRecord): void;
}

/** T2.7 / ADR-0008: per-session budget, hub-wide daily cap and top-ups. */
export class BudgetGuard {
  private readonly host: BudgetHost;
  private readonly dailyCapUsd: number | null;

  constructor(host: BudgetHost, dailyCapUsd: number | null) {
    this.host = host;
    this.dailyCapUsd = dailyCapUsd;
  }

  /**
   * T2.7 (EPIC-P2 §3 BudgetState): checked after every cost-bearing
   * event. 80% -> a visible warning event (this hub has no real push
   * infrastructure yet — "Push-Warnung" in the design doc is honestly
   * represented here as a system event the PWA can surface, not an
   * actual mobile push). 100% -> hard park, fail-closed (no further
   * provider calls happen because the adapter is genuinely stopped, not
   * merely marked). Warns at most once per session (`budgetWarned`)
   * so every subsequent cost-bearing event doesn't re-spam it.
   */
  async check(session: LiveSession): Promise<void> {
    const budget = session.record.budgetUsd;
    if (budget === null) return;
    const terminal = session.record.status === "stopped" || session.record.status === "parked" || session.record.status === "error";
    if (terminal) return;
    if (session.record.costUsd >= budget) {
      await this.host.emitSystem(session, "session.budget_exceeded", { costUsd: session.record.costUsd, budgetUsd: budget });
      await this.host.park(session, "budget");
      return;
    }
    if (!session.budgetWarned && session.record.costUsd >= budget * 0.8) {
      session.budgetWarned = true;
      await this.host.emitSystem(session, "session.budget_warning", {
        costUsd: session.record.costUsd,
        budgetUsd: budget,
        detail: "80% des Budgets verbraucht (kein echter Mobile-Push — dieser Hub hat keine Push-Infrastruktur, siehe EPIC-P2 T2.7)",
      });
    }
  }
  /**
   * T2.7 top-up flow: only actually resumes a session that was parked
   * FOR BUDGET (ADR-0008) — a manually parked or daily-cap-parked session
   * is untouched by raising this one session's own budget. Returns a
   * named failure rather than silently no-op'ing so a caller (the
   * approval-decide route) can surface why nothing happened.
   */
  async applyBudgetTopUp(sessionId: string, newBudgetUsd: number, actor?: string): Promise<Ack> {
    const session = this.host.session(sessionId);
    if (!session) return { ok: false, detail: "session not live" };
    session.record.budgetUsd = newBudgetUsd;
    session.budgetWarned = false;
    this.host.persist(session.record);
    await this.host.emitSystem(session, "session.budget_topup", { newBudgetUsd, actor: actor ?? null });
    if (session.record.status === "parked" && session.record.parkReason === "budget") {
      session.record.parkReason = null;
      await this.host.setStatus(session, "working");
      // Mirrors parkFor()'s real adapter signal — a top-up that only
      // flips the hub's own status back to "working" while the adapter
      // itself is still internally paused (e.g. adapter-dummy's own
      // steer(park) sets its generator loop's running flag false) would
      // show a session that looks resumed but never actually continues.
      if (session.handle) {
        try {
          await session.adapter.steer(session.handle, { kind: "resume" }, this.host.context(session));
        } catch (err) {
          await this.host.emitSystem(session, "session.resume_signal_failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      await this.host.emitSystem(session, "session.resumed_after_topup", { actor: actor ?? null });
    }
    return { ok: true };
  }
  /**
   * T2.7 (EPIC-P2 §3 "Tages-Cap pro Rechner"): a hub-wide cap across every
   * session created since 00:00 UTC today, independent of any single
   * session's own budgetUsd — protection against a runaway/looping agent
   * that a per-session cap wouldn't catch if it never had one set. Parks
   * EVERY live, non-terminal session (there is no single "the" session to
   * blame for a hub-wide cap) rather than silently continuing.
   */
  async checkDailyCap(): Promise<void> {
    if (this.dailyCapUsd === null) return;
    const today = new Date().toISOString().slice(0, 10);
    const spentToday = this.host.records()
      .filter((r) => r.createdAt.slice(0, 10) === today)
      .reduce((sum, r) => sum + r.costUsd, 0);
    if (spentToday < this.dailyCapUsd) return;
    for (const session of this.host.sessions()) {
      const terminal = session.record.status === "stopped" || session.record.status === "parked" || session.record.status === "error";
      if (terminal) continue;
      await this.host.emitSystem(session, "session.daily_cap_exceeded", { spentToday, dailyCapUsd: this.dailyCapUsd });
      await this.host.park(session, "daily_cap");
    }
  }}
