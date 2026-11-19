import { z } from "zod";

/**
 * ADR-0094 (EPIC-P73): Anzeige-Eintrag für automatische Jobs, die außerhalb des
 * Hub-Automations-Schedulers laufen — GitHub-Actions-Workflows (z. B. nightly-bugs,
 * das aus Pipeline-Fehlern Bug-Issues anlegt) und die Issue-Session-Bridge.
 * Bewusst flach und ohne AutomationDefinition-Maschinerie: diese Liste wird
 * angeschaut und verlinkt, nie verplant (kein Precheck, kein Blob, keine
 * Generation — das regelt der Scheduler für seine eigenen Ziele).
 */
export const EXTERNAL_JOB_SOURCES = ["github-actions", "issue-bridge"] as const;
export type ExternalJobSource = (typeof EXTERNAL_JOB_SOURCES)[number];

/**
 * GitHub-Conclusion und Bridge-Zustand in einer Skala: `unknown` ist der ehrliche
 * Wert, wenn ein Ergebnis nicht mehr feststellbar ist — nie geraten (K7-Haltung
 * wie beim AutomationOutcome).
 */
export const EXTERNAL_JOB_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "timeout",
  "cancelled",
  "skipped",
  "unknown",
] as const;
export type ExternalJobStatus = (typeof EXTERNAL_JOB_STATUSES)[number];

export const ExternalJobInfo = z.object({
  source: z.enum(EXTERNAL_JOB_SOURCES),
  /** Workflow-Name bzw. „Issue #12: <Titel>“. */
  name: z.string().min(1).max(120),
  status: z.enum(EXTERNAL_JOB_STATUSES),
  /** Conclusion/Event/Fehlerklasse — kurz, kein Log-Dump (K5-Haltung). */
  detail: z.string().max(500).optional(),
  /** Run- oder Issue-Link (absolute URL) oder Session-Pfad der PWA. */
  url: z.string().min(1).max(500).optional(),
  /** ISO-8601 UTC des letzten bezifferten Zeitpunkts (Start oder Ende). */
  atUtc: z.string().min(20).max(40),
});
export type ExternalJobInfo = z.infer<typeof ExternalJobInfo>;

/**
 * Antwort von GET /api/automations/external: bei Fehler des Frischversuchs die
 * letzte gute Liste MIT Zeitstempel und Fehlerklasse — ein Cache beweist niemals
 * aktuellen Erfolg (K10, Muster ForgeService.cached).
 */
export const ExternalJobsResponse = z.object({
  atUtc: z.string().min(20).max(40),
  staleError: z.string().max(500).nullable(),
  jobs: z.array(ExternalJobInfo).max(100),
});
export type ExternalJobsResponse = z.infer<typeof ExternalJobsResponse>;
