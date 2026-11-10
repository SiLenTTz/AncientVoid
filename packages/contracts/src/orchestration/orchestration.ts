/** EPIC-P40 (ADR-0064): Orchestrierung — Runs, Tasks, Dispatches, Gates, Deliveries. */

import { z } from "zod";

export const OrchestrationTaskStatus = z.enum(["pending", "ready", "running", "done", "failed", "unknown"]);
export type OrchestrationTaskStatus = z.infer<typeof OrchestrationTaskStatus>;

export const OrchestrationDispatchStatus = z.enum(["active", "done", "failed", "stale", "cancelled", "unknown"]);
export type OrchestrationDispatchStatus = z.infer<typeof OrchestrationDispatchStatus>;

export const OrchestrationRunStatus = z.enum(["planning", "running", "awaiting_gate", "done", "failed", "cancelled"]);
export type OrchestrationRunStatus = z.infer<typeof OrchestrationRunStatus>;

export const OrchestrationGateAction = z.enum(["retry_plan", "cancel", "continue", "retry_task"]);
export type OrchestrationGateAction = z.infer<typeof OrchestrationGateAction>;

/** Rahmen, den ein Mensch beim Start festlegt und den der Hub bei jedem Dispatch erzwingt (ADR-0064 §4). */
export const OrchestrationFrame = z.object({
  /** Adapter, die als Worker erlaubt sind (Allowlist; `loop:*` lehnt der Hub ab). */
  adapters: z.array(z.string().min(1)).min(1).max(8),
  /** Koordinator-Adapter für die Plan-Session; null = Plan wurde direkt übergeben. */
  coordinatorAdapter: z.string().min(1).nullable(),
  model: z.string().min(1).nullable().default(null),
  maxTasks: z.number().int().min(1).max(24).default(8),
  maxDispatchesPerTask: z.number().int().min(1).max(3).default(2),
  maxParallel: z.number().int().min(1).max(4).default(2),
});
export type OrchestrationFrame = z.infer<typeof OrchestrationFrame>;

/** Ein Task aus dem (Koordinator- oder Menschen-)Plan. IDs sind innerhalb des Runs eindeutig (T1, T2, …). */
export const OrchestrationTaskPlan = z.object({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/),
  title: z.string().min(1).max(200),
  prompt: z.string().min(1).max(16_000),
  adapter: z.string().min(1),
  model: z.string().min(1).nullable().default(null),
  dependsOn: z.array(z.string()).default([]),
});
export type OrchestrationTaskPlan = z.infer<typeof OrchestrationTaskPlan>;

/** Der Taskplan als Daten — entweder vom Koordinator-Harness erkannt oder direkt übergeben. */
export const OrchestrationPlan = z.object({ tasks: z.array(OrchestrationTaskPlan).min(1) });
export type OrchestrationPlan = z.infer<typeof OrchestrationPlan>;

export const OrchestrationDispatch = z.object({
  id: z.string(),
  /** Versuchsnummer je Task; nur die höchste Generation darf abschließen (stale-Invariante). */
  generation: z.number().int().positive(),
  sessionId: z.string(),
  adapter: z.string(),
  model: z.string().nullable(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  status: OrchestrationDispatchStatus,
  note: z.string().nullable().default(null),
});
export type OrchestrationDispatch = z.infer<typeof OrchestrationDispatch>;

export const OrchestrationDelivery = z.object({
  taskId: z.string(),
  dispatchId: z.string(),
  generation: z.number().int().positive(),
  /** Ergebnis-Metadaten ≤ 4 KB (K5); größere Ergebnisse als BlobRef (EventStore), Text als Vorschau. */
  text: z.string().max(4096),
  bytes: z.number().int().nonnegative(),
  blobRef: z.string().nullable(),
  deliveredAt: z.string(),
});
export type OrchestrationDelivery = z.infer<typeof OrchestrationDelivery>;

export const OrchestrationGate = z.object({
  id: z.string(),
  reason: z.enum(["plan_unreadable", "adapter_not_allowed", "worker_question", "unknown_outcome"]),
  question: z.string().min(1).max(2000),
  options: z.array(z.object({ label: z.string().min(1).max(200), action: OrchestrationGateAction })).min(1).max(4),
  taskId: z.string().nullable().default(null),
  openedAt: z.string(),
  answeredAt: z.string().nullable().default(null),
  answer: z.string().nullable().default(null),
});
export type OrchestrationGate = z.infer<typeof OrchestrationGate>;

export const OrchestrationRun = z.object({
  id: z.string(),
  title: z.string().min(1).max(200),
  goal: z.string().min(1).max(8000),
  project: z.string(),
  frame: OrchestrationFrame,
  /** Woher der Plan stammt: Koordinator-Session oder menschliche Übergabe. */
  planSource: z.enum(["coordinator", "given"]),
  coordinatorSessionId: z.string().nullable().default(null),
  status: OrchestrationRunStatus,
  tasks: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      prompt: z.string(),
      adapter: z.string(),
      model: z.string().nullable(),
      dependsOn: z.array(z.string()),
      status: OrchestrationTaskStatus,
      dispatches: z.array(OrchestrationDispatch),
      result: OrchestrationDelivery.nullable().default(null),
    }),
  ),
  gates: z.array(OrchestrationGate),
  deliveries: z.array(OrchestrationDelivery),
  createdAt: z.string(),
  updatedAt: z.string(),
  endedAt: z.string().nullable().default(null),
});
export type OrchestrationRun = z.infer<typeof OrchestrationRun>;

/** Run-Start über die HTTP-Grenze: Ziel, Rahmen und optionaler fertiger Plan. */
export const OrchestrationRunStart = z.object({
  title: z.string().min(1).max(200),
  goal: z.string().min(1).max(8000),
  project: z.string(),
  frame: OrchestrationFrame,
  plan: OrchestrationPlan.nullable().default(null),
});
export type OrchestrationRunStart = z.infer<typeof OrchestrationRunStart>;

/**
 * Fehlergründe mit HTTP-Code aus dem Hub (422 Rahmen/Plan, 409 Invariante).
 */
export const ORCHESTRATION_ERRORS: Record<string, number> = {
  plan_invalid: 422,
  cycle: 422,
  unknown_dependency: 422,
  adapter_not_allowed: 422,
  too_many_tasks: 422,
  not_found: 404,
  stale_delivery: 409,
  gate_closed: 409,
};
