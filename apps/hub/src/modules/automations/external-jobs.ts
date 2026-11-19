import type { ExternalJobInfo, ExternalJobsResponse } from "@ancientvoid/contracts";
import type { WorkflowRunView } from "@ancientvoid/core";

/**
 * ADR-0094 (EPIC-P73): Anzeige der automatischen Jobs, die außerhalb des
 * Hub-Schedulers laufen — GitHub-Actions-Workflows (je Workflow der letzte
 * Run, TTL-Cache) und die Issue-Session-Bridge. Bei Fehler des Frischversuchs
 * die letzte gute Liste MIT Zeitstempel und Fehlerklasse (K10, Muster
 * ForgeService.cached): ein Cache beweist niemals aktuellen Erfolg.
 */

export interface ExternalJobsDeps {
  actions?: { listLatestWorkflowRuns(): Promise<WorkflowRunView[]> };
  bridge?: { jobs(): ExternalJobInfo[] };
  now?: () => Date;
  ttlMs?: number;
}

const ACTIONS_TTL_MS = 60_000;
const JOBS_CAP = 100;

export function workflowStatus(run: Pick<WorkflowRunView, "status" | "conclusion">): ExternalJobInfo["status"] {
  if (run.status === "in_progress") return "running";
  if (run.status === "queued" || run.status === "waiting" || run.status === "pending") return "queued";
  if (run.status !== "completed") return "unknown";
  switch (run.conclusion) {
    case "success":
      return "succeeded";
    case "failure":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "skipped":
      return "skipped";
    default:
      return "unknown";
  }
}

export class ExternalJobsService {
  private readonly deps: ExternalJobsDeps;
  private cache: { fetchedAt: number; jobs: ExternalJobInfo[] } | null = null;
  private staleError: string | null = null;
  private refreshing: Promise<void> | null = null;

  constructor(deps: ExternalJobsDeps) {
    this.deps = deps;
  }

  async list(): Promise<ExternalJobsResponse> {
    const now = this.deps.now?.() ?? new Date();
    const ttl = this.deps.ttlMs ?? ACTIONS_TTL_MS;
    if (!this.cache || now.getTime() - this.cache.fetchedAt > ttl) await this.refresh();
    const bridgeJobs = this.deps.bridge?.jobs() ?? [];
    const actions = this.cache?.jobs ?? [];
    return {
      atUtc: (this.cache ? new Date(this.cache.fetchedAt) : now).toISOString(),
      staleError: this.staleError,
      jobs: [...bridgeJobs, ...actions].slice(0, JOBS_CAP),
    };
  }

  private async refresh(): Promise<void> {
    if (!this.deps.actions) {
      // Nie konfiguriert ist kein Fehler: ehrlich leer, kein staleError.
      this.cache = { fetchedAt: (this.deps.now?.() ?? new Date()).getTime(), jobs: [] };
      this.staleError = null;
      return;
    }
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        const runs = await this.deps.actions!.listLatestWorkflowRuns();
        this.cache = {
          fetchedAt: (this.deps.now?.() ?? new Date()).getTime(),
          jobs: runs.map((run) => ({
            source: "github-actions" as const,
            name: run.workflow.slice(0, 120),
            status: workflowStatus(run),
            detail: [run.runName !== run.workflow ? run.runName : "", run.event, run.conclusion ?? run.status].filter(Boolean).join(" · ").slice(0, 500) || undefined,
            url: run.url || undefined,
            atUtc: run.atUtc,
          })),
        };
        this.staleError = null;
      } catch (err) {
        // Letzte gute Liste bleibt; Fehlerklasse sichtbar (fail loud, K10).
        this.staleError = `github-actions: ${err instanceof Error ? err.message : String(err)}`.slice(0, 500);
        this.cache ??= { fetchedAt: (this.deps.now?.() ?? new Date()).getTime(), jobs: [] };
      }
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }
}
