import { z } from "zod";
import { WorkspaceManifest } from "./manifest.ts";

/**
 * EPIC-P29 / ADR-0051: Laufzeit-Vertrag des Workspaces — Zustände, Events,
 * Ownership und API. Die Projektion ist ausschließlich aus JSONL + Snapshot
 * faltbar (K7); ohne Manifest gibt es keinen Workspace-Status (Migrationsregel).
 */

/** Laufzeitphase: preparing → ready | failed; needs_attention = unklarer Nebenwirkungszustand (kein blindes Re-Run). */
export const WORKSPACE_PHASES = ["preparing", "ready", "failed", "needs_attention"] as const;
export type WorkspacePhase = (typeof WORKSPACE_PHASES)[number];

/** Archivierung ist separat: tearing_down → archived | cleanup_failed. */
export const WORKSPACE_TEARDOWN_PHASES = ["tearing_down", "archived", "cleanup_failed"] as const;
export type WorkspaceTeardownPhase = (typeof WORKSPACE_TEARDOWN_PHASES)[number];

/** `probing`: Readiness wird nach dem K7-Restore asynchron geprüft („wird geprüft“). */
export const WORKSPACE_SERVICE_STATES = ["starting", "ready", "failed", "stopped", "probing"] as const;
export type WorkspaceServiceState = (typeof WORKSPACE_SERVICE_STATES)[number];

/** K5: Event-Payloads ≤ 4 KB — Detailtexte gekappt, Logs als Blob-Referenz. */
export const MAX_WORKSPACE_DETAIL_CHARS = 500;

/** Die `workspace.*`-Systemevents (Kind im Payload, siehe `session.*`-Vorbild). */
export const WORKSPACE_EVENT_KINDS = [
  "workspace.approval_required",
  "workspace.preparing",
  "workspace.ready",
  "workspace.failed",
  "workspace.needs_attention",
  "workspace.service_ready",
  "workspace.service_failed",
  "workspace.service_stopped",
  "workspace.tearing_down",
  "workspace.archived",
  "workspace.cleanup_failed",
  // EPIC-P67 / ADR-0088: Main-Sync-Events — Payloads in main-sync.ts definiert.
  "workspace.main_sync_checked",
  "workspace.main_sync_applied",
  "workspace.main_sync_conflict",
  "workspace.main_sync_skipped",
  "workspace.main_sync_failed",
] as const;
export type WorkspaceEventKind = (typeof WORKSPACE_EVENT_KINDS)[number];

export const WORKSPACE_FAILURE_KINDS = ["exit", "timeout", "port", "ownership", "include", "unknown"] as const;
export type WorkspaceFailureKind = (typeof WORKSPACE_FAILURE_KINDS)[number];

/** Strukturierter Fehler: nennt Schritt, Exitcode/Timeout und die Log-Blob-Referenz (AC-P29-3). */
export const WorkspaceFailure = z.object({
  /** Schritt- oder Service-ID; "include" für die Dateiübernahme. */
  step: z.string().min(1).max(80),
  kind: z.enum(WORKSPACE_FAILURE_KINDS),
  exitCode: z.number().int().optional(),
  detail: z.string().max(MAX_WORKSPACE_DETAIL_CHARS).optional(),
  logBlobRef: z.string().nullable().default(null),
});
export type WorkspaceFailure = z.infer<typeof WorkspaceFailure>;

/** Umgebungsmarker, den der Hub jedem Service mitgibt — Teil des Eigentumsnachweises (Port allein genügt nie). */
export const WORKSPACE_OWNERSHIP_ENV = "ANCIENTVOID_WORKSPACE_SESSION_ID";

/** Port-Übergabe an Auto-Port-Services: der Hub vergibt und schreibt ihn in diese Variable. */
export const WORKSPACE_SERVICE_PORT_ENV = "ANCIENTVOID_WORKSPACE_PORT";

/** Persistenter Eigentumsnachweis eines Service-Prozesses (K7: aus Snapshot rekonstruierbar). */
export interface WorkspaceServiceOwnership {
  serviceId: string;
  sessionId: string;
  pid: number;
  argv: string[];
  port: number | null;
  startedAt: string;
}

export interface WorkspaceServiceStatus {
  id: string;
  state: WorkspaceServiceState;
  port: number | null;
  pid: number | null;
  failure?: WorkspaceFailure;
  updatedAt: string;
}

/** Faltung des Workspace-Zustands (JSONL + Snapshot, K7 < 3 s). */
export interface WorkspaceStatus {
  sessionId: string;
  phase: WorkspacePhase;
  baseSha: string;
  /** sha256 des an der Basis-SHA gelesenen Manifests. */
  manifestHash: string;
  services: WorkspaceServiceStatus[];
  failure?: WorkspaceFailure;
  /** Persistente Operation (Start/Retry/Teardown), die zuletzt verändert hat — ADR-0019-Muster. */
  operationId: string | null;
  updatedAt: string;
}

/**
 * Was ein Mensch vor der ersten Ausführung — und bei jedem geänderten Hash —
 * zur Freigabe sieht: Projekt, Basis-SHA, Manifest-Hash und das geparste
 * Manifest. Nie Dateiinhalte (`.env`-Inhalt bleibt außerhalb, ADR-0051 §2).
 */
export const WorkspaceSetupApproval = z
  .object({
    project: z.string().min(1),
    baseSha: z.string().min(1),
    manifestHash: z.string().min(1),
    /** Das geparste Manifest exakt in der Form, die ausgeführt würde. */
    manifest: WorkspaceManifest,
  })
  .strict();
export type WorkspaceSetupApproval = z.infer<typeof WorkspaceSetupApproval>;

/** API-Routen (Vertrag T29.1; Implementierung T29.5/T29.6). */
export const workspaceStatusPath = (sessionId: string): string => `/api/sessions/${sessionId}/workspace`;
export const workspaceRetryPath = (sessionId: string): string => `/api/sessions/${sessionId}/workspace/retry`;
export const workspaceServiceLogsPath = (sessionId: string, serviceId: string): string =>
  `/api/sessions/${sessionId}/workspace/services/${serviceId}/logs`;

/**
 * Mobiler Preview-Proxy (T29.6): leitet nur an den genau registrierten
 * Loopback-Service mit begrenztem Pfad weiter — authentifiziert, Origin-geprüft,
 * kein freier URL-Parameter. Bis zur Abnahme bleibt der Zugang blockiert.
 */
export const WORKSPACE_PROXY_PATH = "/api/sessions/:id/workspace/services/:serviceId/proxy";

/** T29.6: kurzlebiges, gebundenes Ticket für Preview-Anfragen ohne Bearer (iframe). */
export const workspacePreviewTicketPath = (sessionId: string, serviceId: string): string =>
  `/api/sessions/${sessionId}/workspace/services/${serviceId}/preview-ticket`;

/** TTL der Preview-Tickets: kurz genug, dass einlecktes Ticket schnell wertlos ist. */
export const WORKSPACE_PREVIEW_TICKET_TTL_MS = 5 * 60_000;
/** Obergrenze offener Tickets pro Hub (DoS-Bremse, STT-Muster). */
export const WORKSPACE_PREVIEW_MAX_PENDING_TICKETS = 64;
/** Frist einer einzelnen Proxy-Weiterleitung. */
export const WORKSPACE_PREVIEW_PROXY_TIMEOUT_MS = 15_000;
/** Obergrenze einer Proxy-Antwort (16 MiB, wie Fleet-Forward). */
export const WORKSPACE_PREVIEW_MAX_BYTES = 16 * 1024 * 1024;
/** K5: Logs-Antwort der Route — Schwanz in Zeichen, nie die ganze Datei. */
export const WORKSPACE_LOGS_TAIL_CHARS = 8_000;

/** Das Ticket für eine Preview-Session: nur der Wert und sein Ablauf (ms seit Epoch). */
export const WorkspacePreviewTicket = z.object({ ticket: z.string().min(20).max(128), expiresAt: z.number().int().positive() }).strict();
export type WorkspacePreviewTicket = z.infer<typeof WorkspacePreviewTicket>;

/** Logs eines Services als gekappter Schwanz (T29.6, K5). */
export const WorkspaceServiceLogs = z.object({
  serviceId: z.string().min(1).max(80),
  tail: z.string().max(WORKSPACE_LOGS_TAIL_CHARS),
  truncated: z.boolean(),
  updatedAt: z.string(),
}).strict();
export type WorkspaceServiceLogs = z.infer<typeof WorkspaceServiceLogs>;
