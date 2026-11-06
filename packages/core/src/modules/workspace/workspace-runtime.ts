import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import type { WorkspaceEventKind, WorkspaceFailure, WorkspaceManifest, WorkspaceStep } from "@ancientvoid/contracts";
import { MAX_WORKSPACE_DETAIL_CHARS } from "@ancientvoid/contracts";
import type { HubDatabase } from "../../platform/db.ts";
import type { EventStore } from "../../platform/eventstore.ts";
import { copyIncludedFiles } from "./include-copy.ts";
import type { ServiceSupervisor } from "./workspace-services.ts";

const execFileAsync = promisify(execFile);

/**
 * EPIC-P29 T29.3 / ADR-0051 §3: Setup/Teardown als persistente Operationen.
 * Vor dem ersten externen Effekt steht die Journalzeile `dispatching` —
 * überlebt sie einen Hub-Crash, markiert die Recovery sie `uncertain`
 * (workspace.needs_attention) und wiederholt nichts automatisch. Ein Fehler
 * mit bekanntem Schritt (`failed`) bleibt menschlich wiederholbar (Retry,
 * neue Operation). Schritte laufen sequenziell mit eigener Frist, ohne
 * Shell; große Ausgaben werden als Blob referenziert (K5).
 */

export type WorkspaceEmit = (kind: WorkspaceEventKind, payload: Record<string, unknown>) => Promise<void>;

export interface WorkspaceRunInput {
  sessionId: string;
  project: string;
  manifest: WorkspaceManifest;
  manifestHash: string;
  worktreePath: string;
  actor: string | null;
  emit: WorkspaceEmit;
}

export type WorkspaceRunResult = { ok: true; operationId: string } | { ok: false; operationId: string; failure: WorkspaceFailure };

interface JournalRow {
  id: string;
  session_id: string;
  kind: string;
  state: string;
  manifest_hash: string;
  step: string | null;
  actor: string | null;
  created_at: string;
  updated_at: string;
}

export const WORKSPACE_OPERATION_KINDS = ["setup", "retry", "teardown"] as const;
export type WorkspaceOperationKind = (typeof WORKSPACE_OPERATION_KINDS)[number];

export class WorkspaceRuntime {
  private readonly db: HubDatabase;
  private readonly store: EventStore;
  private readonly services: ServiceSupervisor;

  constructor(db: HubDatabase, store: EventStore, services: ServiceSupervisor) {
    this.db = db;
    this.store = store;
    this.services = services;
  }

  /** Setup-Schritte (oder Retry — gleiche Semantik, eigene Journal-Art). */
  async runSetup(input: WorkspaceRunInput, kind: "setup" | "retry" = "setup"): Promise<WorkspaceRunResult> {
    return this.run(kind, "workspace.preparing", "workspace.ready", "workspace.failed", input.manifest.setup ?? [], input);
  }

  /** Genehmigter Teardown (ADR-0051 §3: tearing_down → archived | cleanup_failed). */
  async runTeardown(input: WorkspaceRunInput): Promise<WorkspaceRunResult> {
    return this.run("teardown", "workspace.tearing_down", null, "workspace.cleanup_failed", input.manifest.teardown ?? [], input);
  }

  /**
   * K7-Recovery: eine hängen gebliebene `dispatching`-Operation ist ein
   * unklarer Nebenwirkungszustand — markieren (idempotent, genau ein Event
   * pro Operation), niemals von selbst neu ausführen.
   */
  async reconcileAfterCrash(sessionId: string, emit: WorkspaceEmit): Promise<number> {
    const rows = this.db
      .prepare("SELECT * FROM workspace_operations WHERE session_id = ? AND state = 'dispatching'")
      .all(sessionId) as unknown as JournalRow[];
    let marked = 0;
    for (const row of rows) {
      this.db
        .prepare("UPDATE workspace_operations SET state = 'uncertain', updated_at = ? WHERE id = ? AND state = 'dispatching'")
        .run(new Date().toISOString(), row.id);
      await emit("workspace.needs_attention", { operationId: row.id, operationKind: row.kind, step: row.step, manifestHash: row.manifest_hash });
      marked += 1;
    }
    return marked;
  }

  listJournal(sessionId: string): JournalRow[] {
    return this.db
      .prepare("SELECT * FROM workspace_operations WHERE session_id = ? ORDER BY created_at")
      .all(sessionId) as unknown as JournalRow[];
  }

  private async run(
    kind: WorkspaceOperationKind,
    startEvent: WorkspaceEventKind,
    doneEvent: WorkspaceEventKind | null,
    failEvent: WorkspaceEventKind,
    steps: readonly WorkspaceStep[],
    input: WorkspaceRunInput,
  ): Promise<WorkspaceRunResult> {
    const operationId = randomUUID();
    const now = new Date().toISOString();
    // Erst die dauerhafte Marke, dann das Event, dann der Effekt — so sieht
    // die Recovery einen Crash in jeder Phase korrekt als unsicher.
    this.db
      .prepare("INSERT INTO workspace_operations (id, session_id, kind, state, manifest_hash, actor, created_at, updated_at) VALUES (?, ?, ?, 'dispatching', ?, ?, ?, ?)")
      .run(operationId, input.sessionId, kind, input.manifestHash, input.actor, now, now);
    if (startEvent) await input.emit(startEvent, { operationId, manifestHash: input.manifestHash });
    // ADR-0051 §2: explizite Dateiübernahme vor dem Setup — ein abgelehnter
    // Eintrag lässt den ganzen Workspace laut scheitern, nie halbkopiert.
    if ((input.manifest.include ?? []).length > 0) {
      const report = await copyIncludedFiles(input.project, input.worktreePath, input.manifest.include ?? []);
      if (report.rejected.length > 0) {
        const failure: WorkspaceFailure = {
          step: "include",
          kind: "include",
          detail: report.rejected.map((r) => `${r.path}: ${r.reason}`).join("; ").slice(0, MAX_WORKSPACE_DETAIL_CHARS),
          logBlobRef: null,
        };
        this.mark(operationId, "failed", "include");
        await input.emit(failEvent, { failure, operationId, manifestHash: input.manifestHash });
        return { ok: false, operationId, failure };
      }
    }
    for (const step of steps ?? []) {
      const failure = await this.execStep(step, input);
      if (failure) {
        this.mark(operationId, "failed", step.id);
        await input.emit(failEvent, { failure, operationId, manifestHash: input.manifestHash });
        return { ok: false, operationId, failure };
      }
    }
    // ADR-0051 §3: Services erst nach dem Setup — `workspace.ready` feuert
    // erst, wenn alle deklarierten Dienste bereit sind (AC-P29-3).
    if (kind !== "teardown" && (input.manifest.services ?? []).length > 0) {
      const started = await this.services.startAll({
        sessionId: input.sessionId,
        worktreePath: input.worktreePath,
        manifest: input.manifest,
        manifestHash: input.manifestHash,
        emit: input.emit,
      });
      if (!started.ok) {
        const bad = started.outcomes.find((o) => !o.ok)!.failure!;
        this.mark(operationId, "failed", bad.step);
        await input.emit(failEvent, { failure: bad, operationId, manifestHash: input.manifestHash });
        return { ok: false, operationId, failure: bad };
      }
    }
    this.mark(operationId, "done", null);
    if (doneEvent) await input.emit(doneEvent, { operationId, manifestHash: input.manifestHash });
    return { ok: true, operationId };
  }

  private mark(operationId: string, state: "done" | "failed", step: string | null): void {
    this.db
      .prepare("UPDATE workspace_operations SET state = ?, step = ?, updated_at = ? WHERE id = ?")
      .run(state, step, new Date().toISOString(), operationId);
  }

  private async execStep(step: WorkspaceStep, input: WorkspaceRunInput): Promise<WorkspaceFailure | null> {
    try {
      await execFileAsync(step.argv[0]!, step.argv.slice(1), {
        cwd: input.worktreePath,
        timeout: step.timeoutMs,
        maxBuffer: 1024 * 1024,
      });
      return null;
    } catch (err) {
      return await this.failureOf(step, err, input.sessionId);
    }
  }

  /** Fehler benennen Schritt, Exitcode/Timeout und Log-Blob (AC-P29-3, K5). */
  private async failureOf(step: WorkspaceStep, err: unknown, sessionId: string): Promise<WorkspaceFailure> {
    const killed = (err as { killed?: boolean }).killed === true;
    const stdout = String((err as { stdout?: unknown }).stdout ?? "");
    const stderr = String((err as { stderr?: unknown }).stderr ?? "");
    const output = `${stdout}${stderr}`;
    let logBlobRef: string | null = null;
    if (output.trim() !== "") {
      const blob = await this.store.writeBlob(sessionId, output);
      logBlobRef = `sha256:${blob.hash}`;
    }
    const code = (err as { code?: unknown }).code;
    return {
      step: step.id,
      kind: killed ? "timeout" : "exit",
      ...(typeof code === "number" ? { exitCode: code } : {}),
      // Detail = knapper Ausgaben-Schwanz; die volle Ausgabe liegt im Blob.
      ...(output.trim() !== "" ? { detail: output.slice(-200).trim().slice(0, MAX_WORKSPACE_DETAIL_CHARS) } : {}),
      logBlobRef,
    };
  }
}

/** K7-Faltung: die letzte workspace.*-Event-Art bestimmt die Phase. */
export interface FoldedWorkspaceState {
  phase: "approval_required" | "preparing" | "ready" | "failed" | "needs_attention";
  manifestHash: string | null;
}

export function foldWorkspaceState(events: readonly { payload?: unknown }[]): FoldedWorkspaceState | null {
  let last: FoldedWorkspaceState | null = null;
  let lastHash: string | null = null;
  for (const event of events) {
    const payload = event.payload as { kind?: unknown; manifestHash?: unknown } | undefined;
    const kind = payload?.kind;
    if (typeof kind !== "string" || !kind.startsWith("workspace.")) continue;
    const phase = phaseOfKind(kind);
    if (!phase) continue;
    const hash = payload?.manifestHash;
    last = { phase, manifestHash: typeof hash === "string" ? hash : lastHash };
    lastHash = last.manifestHash;
  }
  return last;
}

function phaseOfKind(kind: string): FoldedWorkspaceState["phase"] | null {
  switch (kind) {
    case "workspace.approval_required":
      return "approval_required";
    case "workspace.preparing":
    case "workspace.tearing_down":
      return "preparing";
    case "workspace.ready":
      return "ready";
    case "workspace.failed":
    case "workspace.cleanup_failed":
      return "failed";
    case "workspace.needs_attention":
      return "needs_attention";
    default:
      return null; // service_* sind Servicezustand (T29.4), keine Workspace-Phase
  }
}
