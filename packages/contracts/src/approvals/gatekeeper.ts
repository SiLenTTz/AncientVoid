import { z } from "zod";

/**
 * T7.9 — System-1 gatekeeper for tool requests (Laya principle, ADR-0024).
 * A fast local judgement next to every tool approval. It only ever makes a
 * request look *more* dangerous; it never approves anything.
 */

/** Ordered from harmless to worst. */
export const TOOL_RISKS = ["READ_ONLY", "LOCAL_WRITE", "DESTRUCTIVE", "EXFILTRATION"] as const;
export const ToolRisk = z.enum(TOOL_RISKS);
export type ToolRisk = z.infer<typeof ToolRisk>;

export const SECURITY_GATES = ["CLEAN", "WARNING", "CRITICAL_BLOCK"] as const;
export const SecurityGate = z.enum(SECURITY_GATES);
export type SecurityGate = z.infer<typeof SecurityGate>;

export const ToolAssessment = z.object({
  toolRisk: ToolRisk,
  securityGate: SecurityGate,
  /** Who set the final value: the model, the fixed rules (a floor the model
   * cannot lower), or the fail-closed fallback (model missing/unsure). */
  source: z.enum(["model", "rules", "fallback"]),
  /** Model probability of its own answer per field (null without model). */
  confidence: z.object({ toolRisk: z.number().min(0).max(1).nullable(), securityGate: z.number().min(0).max(1).nullable() }),
  model: z.string().nullable(),
  latencyMs: z.number().int().nonnegative().nullable(),
  /** Short reasons, e.g. which rule fired or why it escalated. */
  notes: z.array(z.string().max(160)).max(6),
});
export type ToolAssessment = z.infer<typeof ToolAssessment>;

export function riskRank(r: ToolRisk): number {
  return TOOL_RISKS.indexOf(r);
}

export function gateRank(g: SecurityGate): number {
  return SECURITY_GATES.indexOf(g);
}

export function stricterRisk(a: ToolRisk, b: ToolRisk): ToolRisk {
  return riskRank(a) >= riskRank(b) ? a : b;
}

export function stricterGate(a: SecurityGate, b: SecurityGate): SecurityGate {
  return gateRank(a) >= gateRank(b) ? a : b;
}

export interface ModelVerdict {
  toolRisk: ToolRisk;
  securityGate: SecurityGate;
  confidence: { toolRisk: number; securityGate: number };
  model: string;
  latencyMs: number;
}

export interface RuleVerdict {
  toolRisk: ToolRisk;
  securityGate: SecurityGate;
  notes: string[];
}

/** Below this a field is treated as unsure — and goes one step stricter. */
export const GATEKEEPER_MIN_CONFIDENCE = 0.8;

/**
 * Fail-closed combination (AC-P7-7): the stricter of rules and model wins;
 * an unsure field goes one step up; no model at all means at least WARNING.
 */
export function combineAssessment(rules: RuleVerdict, model: ModelVerdict | null, why?: string, minConfidence = GATEKEEPER_MIN_CONFIDENCE): ToolAssessment {
  const notes = [...rules.notes];
  if (!model) {
    notes.push(`Modell nicht verfügbar${why ? ` (${why})` : ""} — mindestens Warnung.`);
    return {
      toolRisk: rules.toolRisk,
      securityGate: stricterGate(rules.securityGate, "WARNING"),
      source: "fallback",
      confidence: { toolRisk: null, securityGate: null },
      model: null,
      latencyMs: null,
      notes: notes.slice(0, 6),
    };
  }
  let risk = model.toolRisk;
  let gate = model.securityGate;
  let unsure = false;
  if (model.confidence.toolRisk < minConfidence && riskRank(risk) < TOOL_RISKS.length - 1) {
    risk = TOOL_RISKS[riskRank(risk) + 1]!;
    unsure = true;
    notes.push(`Risiko unsicher (${Math.round(model.confidence.toolRisk * 100)} %) — eine Stufe strenger.`);
  }
  if (model.confidence.securityGate < minConfidence && gateRank(gate) < SECURITY_GATES.length - 1) {
    gate = SECURITY_GATES[gateRank(gate) + 1]!;
    unsure = true;
    notes.push(`Einstufung unsicher (${Math.round(model.confidence.securityGate * 100)} %) — eine Stufe strenger.`);
  }
  const finalRisk = stricterRisk(risk, rules.toolRisk);
  const finalGate = stricterGate(gate, rules.securityGate);
  const rulesWon = finalRisk !== risk || finalGate !== gate;
  return {
    toolRisk: finalRisk,
    securityGate: finalGate,
    source: rulesWon ? "rules" : unsure ? "fallback" : "model",
    confidence: model.confidence,
    model: model.model,
    latencyMs: model.latencyMs,
    notes: notes.slice(0, 6),
  };
}

/** A request the gatekeeper calls critical needs the passkey (ADR-0007). */
export function requiresPasskey(a: ToolAssessment | null | undefined): boolean {
  return a?.securityGate === "CRITICAL_BLOCK";
}
