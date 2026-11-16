import { combineAssessment, type ToolAssessment } from "@ancientvoid/contracts";
import { assessByRules } from "./rules.ts";
import { askGatekeeperModel, type GatekeeperModelConfig } from "./model.ts";

export interface GatekeeperOptions {
  /** Absent: rules only (every result says so). */
  model?: GatekeeperModelConfig;
  /** The approval waits at most this long for the model. */
  timeoutMs?: number;
  minConfidence?: number;
}

/**
 * T7.9 (ADR-0024): rules + local model, combined fail-closed. Runs before
 * a tool approval is created; a CRITICAL_BLOCK makes it destructive.
 * Never approves, never throws — a failure is itself a (stricter) result.
 */
export class Gatekeeper {
  private readonly opts: GatekeeperOptions;

  constructor(opts: GatekeeperOptions = {}) {
    this.opts = opts;
  }

  async assess(toolName: string, input: Record<string, unknown>, workdir: string | null): Promise<ToolAssessment> {
    const rules = assessByRules(toolName, input, workdir);
    // Without a model the rules speak alone — no invented warning. A model
    // that is configured but fails is a different story (fail-closed below).
    if (!this.opts.model) return { toolRisk: rules.toolRisk, securityGate: rules.securityGate, source: "rules", confidence: { toolRisk: null, securityGate: null }, model: null, latencyMs: null, notes: rules.notes };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 8000);
    try {
      const verdict = await askGatekeeperModel(this.opts.model, toolName, input, workdir, controller.signal);
      return combineAssessment(rules, verdict, undefined, this.opts.minConfidence);
    } catch (err) {
      const why = controller.signal.aborted ? "Zeitlimit" : err instanceof Error ? err.message.slice(0, 60) : "Fehler";
      return combineAssessment(rules, null, why, this.opts.minConfidence);
    } finally {
      clearTimeout(timer);
    }
  }
}
