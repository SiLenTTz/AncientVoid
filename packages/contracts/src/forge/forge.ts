import { z } from "zod";

/**
 * EPIC-P37 / ADR-0056: GitLab im Session-Kontext. Identität ist immer
 * Host + Projekt-ID + IID — selbst gehostete GitLabs mit gleichen IIDs
 * kollidieren nicht (AC-P37-1). Zitierte Fremdtexte (Kommentare, Logs)
 * sind Daten, niemals Ausführungsbefugnis (PRD §8.5).
 */

/** Normalisierter Host, z. B. "gitlab.com" — ohne Schema/Pfad. */
export const ForgeHost = z.string().min(3).max(253).regex(/^[a-z0-9.-]+$/);
export type ForgeHost = z.infer<typeof ForgeHost>;

/** Eindeutige MR-Identität über alle GitLab-Hosts hinweg. */
export const ForgeMrRef = z.object({
  host: ForgeHost,
  projectId: z.number().int().positive(),
  projectPath: z.string().min(1).max(500).optional(),
  mrIid: z.number().int().positive(),
});
export type ForgeMrRef = z.infer<typeof ForgeMrRef>;

/** GitLab-Pipelinestatus, getrennt geführt — nur "success" ist grün (AC-P37-2). */
export const FORGE_PIPELINE_STATUSES = [
  "created",
  "waiting_for_resource",
  "preparing",
  "pending",
  "running",
  "success",
  "failed",
  "canceled",
  "skipped",
  "manual",
  "scheduled",
] as const;
export type ForgePipelineStatus = (typeof FORGE_PIPELINE_STATUSES)[number];

export const isPipelineGreen = (status: ForgePipelineStatus): boolean => status === "success";

export const ForgePipelineSummary = z.object({
  id: z.number().int().positive(),
  /** Fortlaufende Pipeline-IID im Projekt (Anzeige), nicht die ID. */
  iid: z.number().int().positive().nullable(),
  status: z.literal(FORGE_PIPELINE_STATUSES),
  sha: z.string().regex(/^[0-9a-f]{7,40}$/).nullable(),
  ref: z.string(),
  webUrl: z.string(),
  createdAt: z.string().nullable(),
});
export type ForgePipelineSummary = z.infer<typeof ForgePipelineSummary>;

/** Ein Job einer Pipeline; Bridge-Jobs tragen die Downstream-Pipeline (AC-P37-2). */
export const ForgeJobSummary = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  status: z.literal(FORGE_PIPELINE_STATUSES),
  stage: z.string(),
  /** "bridge" = Trigger-Job einer Downstream-Pipeline (Child-Pipeline). */
  kind: z.literal(["job", "bridge"]),
  downstreamPipelineId: z.number().int().positive().nullable(),
  allowFailure: z.boolean(),
  webUrl: z.string(),
});
export type ForgeJobSummary = z.infer<typeof ForgeJobSummary>;

/** Eine Notiz in einem MR-Thread — zitierte Daten, gekappt für K3/K5. */
export const ForgeThreadNote = z.object({
  author: z.string(),
  body: z.string(),
  system: z.boolean(),
  createdAt: z.string().nullable(),
});
export type ForgeThreadNote = z.infer<typeof ForgeThreadNote>;

export const ForgeThread = z.object({
  id: z.string(),
  resolved: z.boolean(),
  notes: z.array(ForgeThreadNote).max(50),
});
export type ForgeThread = z.infer<typeof ForgeThread>;

export const ForgeMrSummary = z.object({
  ref: ForgeMrRef,
  title: z.string(),
  state: z.literal(["opened", "closed", "merged", "locked"]),
  draft: z.boolean(),
  sourceBranch: z.string(),
  targetBranch: z.string(),
  /** Head-SHA des MR beim Abruf — Bezugsgröße für Feedback (SHA-Pinning). */
  sha: z.string().regex(/^[0-9a-f]{7,40}$/).nullable(),
  webUrl: z.string(),
  author: z.string(),
  updatedAt: z.string().nullable(),
});
export type ForgeMrSummary = z.infer<typeof ForgeMrSummary>;

export const ForgeIssueSummary = z.object({
  host: ForgeHost,
  projectId: z.number().int().positive(),
  iid: z.number().int().positive(),
  title: z.string(),
  description: z.string(),
  state: z.literal(["opened", "closed"]),
  author: z.string(),
  webUrl: z.string(),
  labels: z.array(z.string()).max(30),
});
export type ForgeIssueSummary = z.infer<typeof ForgeIssueSummary>;

/** Verknüpfung Session ↔ MR (kanonisch im ForgeStore-Journal, K7). */
export const ForgeLink = z.object({
  sessionId: z.string().min(1),
  mr: ForgeMrRef,
  /** SHA und Zeitpunkt des letzten erfolgreichen Abrufs (Drift-Markierung). */
  lastSha: z.string().regex(/^[0-9a-f]{7,40}$/).nullable(),
  lastFetchedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type ForgeLink = z.infer<typeof ForgeLink>;

/** Operationsstatus für Mutationen (Draft-MR, Feedback) — persisted, K7. */
export const FORGE_OPERATION_STATES = ["pending", "done", "failed", "uncertain"] as const;
export type ForgeOperationState = (typeof FORGE_OPERATION_STATES)[number];

export const ForgeOperation = z.object({
  id: z.string().min(8).max(128),
  kind: z.literal(["feedback_send", "draft_mr"]),
  state: z.literal(FORGE_OPERATION_STATES),
  /** Der SHA, gegen den der Vorgang bewertet wurde (SHA-Pinning, §3.3). */
  sha: z.string().regex(/^[0-9a-f]{7,40}$/).nullable(),
  pipelineId: z.number().int().positive().nullable(),
  jobId: z.number().int().positive().nullable(),
  detail: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ForgeOperation = z.infer<typeof ForgeOperation>;

/** Gekappte Trace-Vorschau + Bezug auf die vollständige Datei (ADR §10). */
export const FORGE_TRACE_PREVIEW_CHARS = 8_000;
export const FORGE_TRACE_MAX_BYTES = 2 * 1024 * 1024;

export const ForgeTraceView = z.object({
  jobId: z.number().int().positive(),
  pipelineId: z.number().int().positive().nullable(),
  sha: z.string().regex(/^[0-9a-f]{7,40}$/).nullable(),
  /** Zeitstempel des Abrufs — Cache beweist keinen aktuellen Erfolg (K10). */
  fetchedAt: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  truncated: z.boolean(),
  preview: z.string(),
});
export type ForgeTraceView = z.infer<typeof ForgeTraceView>;

/** Verknüpfen: MR-URL oder Host+Projekt+IID (Projekt wird aufgelöst). */
export const LinkMrInput = z.object({
  url: z.string().min(1).max(2_000).optional(),
  ref: ForgeMrRef.optional(),
});
export type LinkMrInput = z.infer<typeof LinkMrInput>;

/** CI-/Review-Befund → Folgeauftrag über den P36-Versandweg (ADR §8). */
export const SendForgeFeedbackInput = z.object({
  operationId: z.string().min(8).max(128),
  finding: z.string().min(1).max(8_000),
  /** Quellenrahmen: mindestens eine der drei Referenzen ist Pflicht (§3.3). */
  pipelineId: z.number().int().positive().optional(),
  jobId: z.number().int().positive().optional(),
  threadId: z.string().min(1).max(200).optional(),
  /** Ziel-Session; Default die verknüpfte Session selbst. */
  targetSessionId: z.string().min(1).optional(),
});
export type SendForgeFeedbackInput = z.infer<typeof SendForgeFeedbackInput>;

/** Read-only Plan für den Draft-MR — keine Mutation vor Bestätigung (ADR §9). */
export const DraftMrPlan = z.object({
  branch: z.string().min(1),
  /** Commits, die gepusht würden, ältester zuerst. */
  commitsAhead: z.array(z.object({ sha: z.string(), subject: z.string() })).max(200),
  pushNeeded: z.boolean(),
  host: ForgeHost,
  projectId: z.number().int().positive().nullable(),
  projectPath: z.string().min(1),
  targetBranch: z.string().min(1),
  suggestedTitle: z.string(),
  sessionTitle: z.string().min(1).nullable(),
});
export type DraftMrPlan = z.infer<typeof DraftMrPlan>;

export const CreateDraftMrInput = z.object({
  operationId: z.string().min(8).max(128),
  title: z.string().min(3).max(120),
  description: z.string().max(20_000),
  targetBranch: z.string().min(1).max(200).default("main"),
  /** Branch vorher pushen (normalerweise wahr, wenn Commits fehlen). */
  push: z.boolean().default(true),
});
export type CreateDraftMrInput = z.infer<typeof CreateDraftMrInput>;

export const DraftMrResult = z.object({
  ok: z.boolean(),
  webUrl: z.string().nullable(),
  detail: z.string().nullable(),
  /** Bei uncertain: Retry sucht zuerst nach bestehendem MR (AC-P37-5). */
  state: z.literal(FORGE_OPERATION_STATES),
});
export type DraftMrResult = z.infer<typeof DraftMrResult>;
