/** EPIC-P40 (ADR-0064), EPIC-P60 (ADR-0077): Agenten-Teams — Team, Tasks, Dispatches, Gates, Deliveries (Run→Team umbenannt). */

import { z } from "zod";

export const TeamTaskStatus = z.enum(["pending", "ready", "running", "done", "failed", "unknown"]);
export type TeamTaskStatus = z.infer<typeof TeamTaskStatus>;

export const TeamDispatchStatus = z.enum(["active", "done", "failed", "stale", "cancelled", "unknown"]);
export type TeamDispatchStatus = z.infer<typeof TeamDispatchStatus>;

export const TeamStatus = z.enum(["planning", "running", "awaiting_gate", "done", "failed", "cancelled"]);
export type TeamStatus = z.infer<typeof TeamStatus>;

export const TeamGateAction = z.enum(["retry_plan", "cancel", "continue", "retry_task"]);
export type TeamGateAction = z.infer<typeof TeamGateAction>;

/** Rahmen, den ein Mensch beim Start festlegt und den der Hub bei jedem Dispatch erzwingt (ADR-0064 §4). */
const TeamFrameBase = z.object({
  /** Adapter, die als Worker erlaubt sind (Allowlist; `loop:*` lehnt der Hub ab). */
  adapters: z.array(z.string().min(1)).min(1).max(8),
  /** Koordinator-Adapter für die Plan-Session; null = Plan wurde direkt übergeben. */
  coordinatorAdapter: z.string().min(1).nullable(),
  /** ADR-0077 (T60.8): Modell-Allowlist für Task-Modelle (leer = nur Adapter-Standardmodell);
   *  die Koordinator-Session nutzt das erste erlaubte Modell oder den Adapter-Standard. */
  models: z.array(z.string().min(1)).max(16).default([]),
  maxTasks: z.number().int().min(1).max(24).default(8),
  maxDispatchesPerTask: z.number().int().min(1).max(3).default(2),
  /** ADR-0077 (T60.7): Deckel 8 — breite Teams sind erlaubt; die harte Obergrenze bleiben die Session-Grenzen (K8). */
  maxParallel: z.number().int().min(1).max(8).default(2),
});
/** ADR-0077 §6: persistierte Altedform mit `model: string|null` wird toleriert gelesen (z. B. eingefrorene Automation-Blobs). */
export const TeamFrame = z.preprocess(
  (v) => {
    if (typeof v !== "object" || v === null) return v;
    const f = v as { model?: unknown; models?: unknown };
    if (f.models === undefined && "model" in f) {
      return { ...f, models: typeof f.model === "string" && f.model.length > 0 ? [f.model] : [] };
    }
    return v;
  },
  TeamFrameBase,
);
export type TeamFrame = z.infer<typeof TeamFrame>;

/** Ein Task aus dem (Koordinator- oder Menschen-)Plan. IDs sind innerhalb des Teams eindeutig (T1, T2, …). */
export const TeamTaskPlan = z.object({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/),
  title: z.string().min(1).max(200),
  prompt: z.string().min(1).max(16_000),
  adapter: z.string().min(1),
  model: z.string().min(1).nullable().default(null),
  dependsOn: z.array(z.string()).default([]),
});
export type TeamTaskPlan = z.infer<typeof TeamTaskPlan>;

/** Der Taskplan als Daten — entweder vom Koordinator-Harness erkannt oder direkt übergeben. */
export const TeamPlan = z.object({ tasks: z.array(TeamTaskPlan).min(1) });
export type TeamPlan = z.infer<typeof TeamPlan>;

export const TeamDispatch = z.object({
  id: z.string(),
  /** Versuchsnummer je Task; nur die höchste Generation darf abschließen (stale-Invariante). */
  generation: z.number().int().positive(),
  sessionId: z.string(),
  adapter: z.string(),
  model: z.string().nullable(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  status: TeamDispatchStatus,
  note: z.string().nullable().default(null),
});
export type TeamDispatch = z.infer<typeof TeamDispatch>;

export const TeamDelivery = z.object({
  taskId: z.string(),
  dispatchId: z.string(),
  generation: z.number().int().positive(),
  /** Ergebnis-Metadaten ≤ 4 KB (K5); größere Ergebnisse als BlobRef (EventStore), Text als Vorschau. */
  text: z.string().max(4096),
  bytes: z.number().int().nonnegative(),
  blobRef: z.string().nullable(),
  deliveredAt: z.string(),
});
export type TeamDelivery = z.infer<typeof TeamDelivery>;

export const TeamGate = z.object({
  id: z.string(),
  reason: z.enum(["plan_unreadable", "adapter_not_allowed", "worker_question", "unknown_outcome"]),
  question: z.string().min(1).max(2000),
  options: z.array(z.object({ label: z.string().min(1).max(200), action: TeamGateAction })).min(1).max(4),
  taskId: z.string().nullable().default(null),
  openedAt: z.string(),
  answeredAt: z.string().nullable().default(null),
  answer: z.string().nullable().default(null),
});
export type TeamGate = z.infer<typeof TeamGate>;

export const Team = z.object({
  id: z.string(),
  title: z.string().min(1).max(200),
  goal: z.string().min(1).max(8000),
  project: z.string(),
  frame: TeamFrame,
  /** Woher der Plan stammt: Koordinator-Session oder menschliche Übergabe. */
  planSource: z.enum(["coordinator", "given"]),
  coordinatorSessionId: z.string().nullable().default(null),
  status: TeamStatus,
  tasks: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      prompt: z.string(),
      adapter: z.string(),
      model: z.string().nullable(),
      dependsOn: z.array(z.string()),
      status: TeamTaskStatus,
      dispatches: z.array(TeamDispatch),
      result: TeamDelivery.nullable().default(null),
    }),
  ),
  gates: z.array(TeamGate),
  deliveries: z.array(TeamDelivery),
  createdAt: z.string(),
  updatedAt: z.string(),
  endedAt: z.string().nullable().default(null),
});
export type Team = z.infer<typeof Team>;

/** Team-Start über die HTTP-Grenze: Ziel, Rahmen und optionaler fertiger Plan. */
export const TeamStart = z.object({
  title: z.string().min(1).max(200),
  goal: z.string().min(1).max(8000),
  project: z.string(),
  frame: TeamFrame,
  plan: TeamPlan.nullable().default(null),
});
export type TeamStart = z.infer<typeof TeamStart>;

/**
 * Fehlergründe mit HTTP-Code aus dem Hub (422 Rahmen/Plan, 409 Invariante).
 */
export const TEAM_ERRORS: Record<string, number> = {
  plan_invalid: 422,
  cycle: 422,
  unknown_dependency: 422,
  adapter_not_allowed: 422,
  /** ADR-0077 (T60.8): Task-Modell außerhalb der Frame-Allowlist — vorher ging es ungeprüft durch. */
  model_not_allowed: 422,
  too_many_tasks: 422,
  not_found: 404,
  stale_delivery: 409,
  gate_closed: 409,
};
