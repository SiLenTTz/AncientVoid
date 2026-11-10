import type { AutomationDefinition, AutomationSkipReason, AutomationOutcome, AutomationClaimState } from "@ancientvoid/contracts";
import type { AutomationStore, ClaimState } from "./store.ts";
import { nextOccurrences } from "./schedule.ts";

/**
 * EPIC-P41 T41.3 (ADR-0064): Scheduler auf dem Eigentümer-Host. Er besitzt
 * Termin, Claim und Regeln (Dedupe/Overlap/Missed/Grace) — die Ausführung gehört
 * dem Dispatcher (T41.4: Session-/Run-Manager). `dispatched` ist nie `succeeded`.
 */

export type DispatchResult =
  | { ok: true; sessionId?: string; runId?: string }
  | { ok: false; reason: AutomationSkipReason };

/** Precheck-Antwort: null = erfüllt; sonst der getrennte Grund (auth/quota/lease/... inkl. Exit/Timeout). */
export type PrecheckResult = "ok" | null | AutomationSkipReason;

export interface AutomationsDeps {
  store: AutomationStore;
  hostId: string;
  /** Uhr injectierbar — Tests halten eine kontrollierte Uhr (AC-P41-2). */
  now: () => number;
  /** Vorgelagerte registrierte argv-Aktion; ohne Definitionsfeld wird nicht geprüft. */
  precheck(definition: AutomationDefinition, deadlineMs: number): Promise<PrecheckResult>;
  /** Der eigentliche Start beim Ausführungseigentümer. */
  dispatch(definition: AutomationDefinition, claimKey: string, occurrenceUtc: string, kind: "due" | "run_now" | "catchup"): Promise<DispatchResult>;
  log?: (line: string) => void;
}

export class AutomationsScheduler {
  private readonly deps: AutomationsDeps;
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(deps: AutomationsDeps, intervalMs = 60_000) {
    this.deps = deps;
    this.intervalMs = intervalMs;
  }

  /** Minütlicher Tick plus direkt nach dem Start (Recovery ohne Zeitfenster-Frist). */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Ein Tick verarbeitet alle fälligen Vorkommnisse aller aktiven Definitionen dieses Hosts. */
  async tick(): Promise<void> {
    const now = this.deps.now();
    for (const def of this.deps.store.listDefinitions()) {
      if (!def.enabled || def.hostId !== this.deps.hostId) continue;
      await this.processDefinition(def, now);
    }
    this.deps.store.saveSnapshot();
  }

  /** Run jetzt (eigene Operation, §3.3): Precheck standardmäßig wie beim Planungslauf. */
  async runNow(definitionId: string): Promise<ClaimState | null> {
    const def = this.deps.store.definition(definitionId);
    if (!def) return null;
    return this.handleOccurrence(def, new Date(this.deps.now()).toISOString(), "run_now");
  }

  /** Der Mensch rechnet das Ergebnis eines referenzierten Laufs ab (Spiegel, kein Erfinden). */
  settle(claimKey: string, outcome: AutomationOutcome): ClaimState | null {
    return this.deps.store.updateClaim(claimKey, { state: "settled", outcome }, new Date(this.deps.now()).toISOString());
  }

  private async processDefinition(def: AutomationDefinition, nowMs: number): Promise<void> {
    const nowIso = new Date(nowMs).toISOString();
    const handled = this.deps.store.claimsFor(def.id);
    const lastHandled = handled.reduce<string | null>((max, c) => (max === null || c.occurrenceUtc > max ? c.occurrenceUtc : max), null);
    // Termine seit dem zuletzt bearbeiteten Vorkommen (Cursor aus dem Journal — K7-Replay ohne Gedächtnis).
    const horizon = new Date(nowMs + this.intervalMs + 30_000).toISOString();
    const upcoming = this.occurrencesSince(def, lastHandled ?? def.createdAtUtc, horizon).filter((o) => o <= nowIso);
    if (upcoming.length === 0) return;
    for (let i = 0; i < upcoming.length; i++) {
      const occurrence = upcoming[i]!;
      const isLast = i === upcoming.length - 1;
      const lateness = nowMs - Date.parse(occurrence);
      const onTime = lateness <= this.intervalMs;
      const withinGrace = lateness <= def.grant.missedGraceMs;
      if (isLast && (onTime || withinGrace)) {
        await this.handleOccurrence(def, occurrence, onTime ? "due" : "catchup", nowIso);
        continue;
      }
      // Höchstens einmal nachholen: alles andere landet als skipped_missed im Journal.
      const fresh = this.deps.store.claim(def.id, def.generation, occurrence, nowIso);
      if (fresh) this.deps.store.updateClaim(fresh.claimKey, { state: "skipped", reason: "missed" }, nowIso);
    }
  }

  /** Alle Termine strikt nach `sinceIso` bis `untilIso` (der Engine-Ausdruck schließt Lücken ein). */
  private occurrencesSince(def: AutomationDefinition, sinceIso: string, untilIso: string): string[] {
    const out: string[] = [];
    let cursor = sinceIso;
    for (;;) {
      const next = nextOccurrences(def.schedule, cursor, 1);
      if (next.length === 0 || next[0]!.utc > untilIso) break;
      out.push(next[0]!.utc);
      cursor = next[0]!.utc;
    }
    return out;
  }

  private async handleOccurrence(def: AutomationDefinition, occurrenceUtc: string, kind: "due" | "run_now" | "catchup", nowIsoArg?: string): Promise<ClaimState | null> {
    const nowIso = nowIsoArg ?? new Date(this.deps.now()).toISOString();
    const existing = this.deps.store.claim(def.id, def.generation, occurrenceUtc, nowIso);
    if (!existing) return null; // Dedupe: Schlüssel schon verbucht (Auch nach Crash: kein blindes Replay.)
    if (def.precheckActionId) {
      const verdict = await this.deps.precheck(def, def.precheckDeadlineMs);
      if (verdict !== null && verdict !== "ok") {
        return this.deps.store.updateClaim(existing.claimKey, { state: "skipped", reason: verdict }, nowIso);
      }
    }
    if (this.deps.store.inFlight(def.id) > def.grant.maxParallel) {
      // Der eigene Claim zählt bereits — deshalb `>`: maxParallel=1 lässt genau einen offenen Lauf zu.
      return this.deps.store.updateClaim(existing.claimKey, { state: "skipped", reason: "overlap" }, nowIso);
    }
    const result = await this.deps.dispatch(def, existing.claimKey, occurrenceUtc, kind);
    if (result.ok) {
      const patch: { state: AutomationClaimState; sessionId?: string; runId?: string } = { state: "dispatched" };
      if (result.sessionId !== undefined) patch.sessionId = result.sessionId;
      if (result.runId !== undefined) patch.runId = result.runId;
      return this.deps.store.updateClaim(existing.claimKey, patch, nowIso);
    }
    return this.deps.store.updateClaim(existing.claimKey, { state: "skipped", reason: result.reason }, nowIso);
  }
}
