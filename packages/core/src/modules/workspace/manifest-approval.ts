import type { WorkspaceManifest, WorkspaceSetupApproval } from "@ancientvoid/contracts";
import type { HubDatabase } from "../../platform/db.ts";
import type { ResolvedManifest } from "./manifest-resolver.ts";

/**
 * EPIC-P29 T29.2 / ADR-0051 §2: Menschengesteuerte Hash-Freigabe pro Projekt.
 * Schlüssel ist (project, manifestHash) — was ausgeführt wird, ist der
 * Manifest-Inhalt; derselbe Inhalt braucht keine zweite Zustimmung, jeder
 * geänderte Hash genau eine neue. Agentenausgaben können nichts registrieren:
 * `approve()` ist bewusst ein schlichter, von der Route/Policy (ADR-0021,
 * Mensch entscheidet) aufgerufener Baustein, kein Ereignis-Konsument.
 */
export interface ManifestApprovalInput {
  project: string;
  manifestHash: string;
  baseSha: string;
  approvedBy: string;
}

export interface ManifestApprovalRecord extends ManifestApprovalInput {
  approvedAt: string;
}

export class ManifestApprovalStore {
  private readonly db: HubDatabase;

  constructor(db: HubDatabase) {
    this.db = db;
  }

  isApproved(project: string, manifestHash: string): boolean {
    const row = this.db
      .prepare("SELECT 1 FROM workspace_manifest_approvals WHERE project = ? AND manifest_hash = ?")
      .get(project, manifestHash);
    return row !== undefined;
  }

  approve(input: ManifestApprovalInput): ManifestApprovalRecord {
    const record: ManifestApprovalRecord = { ...input, approvedAt: new Date().toISOString() };
    this.db
      .prepare(
        `INSERT INTO workspace_manifest_approvals (project, manifest_hash, base_sha, approved_by, approved_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(project, manifest_hash) DO UPDATE SET base_sha = excluded.base_sha, approved_by = excluded.approved_by, approved_at = excluded.approved_at`,
      )
      .run(record.project, record.manifestHash, record.baseSha, record.approvedBy, record.approvedAt);
    return record;
  }

  list(project: string): ManifestApprovalRecord[] {
    const rows = this.db
      .prepare(
        "SELECT project, manifest_hash, base_sha, approved_by, approved_at FROM workspace_manifest_approvals WHERE project = ? ORDER BY approved_at DESC",
      )
      .all(project) as unknown as {
      project: string;
      manifest_hash: string;
      base_sha: string;
      approved_by: string;
      approved_at: string;
    }[];
    return rows.map((row) => ({
      project: row.project,
      manifestHash: row.manifest_hash,
      baseSha: row.base_sha,
      approvedBy: row.approved_by,
      approvedAt: row.approved_at,
    }));
  }
}

/**
 * Die eine Entscheidung vor jeder Ausführung: ungültig, freizugeben oder
 * freigegeben. `approval_required` trägt genau den Payload, den ein Mensch
 * sieht (WorkspaceSetupApproval) — Projekt, Basis-SHA, Hash, geparstes
 * Manifest; nie Dateiinhalte (ADR-0051 §2).
 */
export type ManifestGate =
  | { ok: true; manifest: WorkspaceManifest; manifestHash: string }
  | { ok: false; kind: "invalid"; reason: string }
  | { ok: false; kind: "approval_required"; approval: WorkspaceSetupApproval };

export function gateManifest(
  resolved: ResolvedManifest,
  project: string,
  baseSha: string | null,
  approvals: ManifestApprovalStore,
): ManifestGate {
  if (resolved.status === "none") return { ok: false, kind: "invalid", reason: "kein Manifest" };
  if (resolved.status === "invalid") return { ok: false, kind: "invalid", reason: resolved.reason };
  if (baseSha === null) return { ok: false, kind: "invalid", reason: "keine Basis-SHA" };
  if (approvals.isApproved(project, resolved.manifestHash)) {
    return { ok: true, manifest: resolved.manifest, manifestHash: resolved.manifestHash };
  }
  return {
    ok: false,
    kind: "approval_required",
    approval: { project, baseSha, manifestHash: resolved.manifestHash, manifest: resolved.manifest },
  };
}
