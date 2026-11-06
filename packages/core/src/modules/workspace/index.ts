/** Public API of this module (ADR-0020). Other modules import only from here. */
export { discoverProjects, isProjectPathAllowed, createProject, type DiscoveredProject, type ProjectDiscoveryResult, type CreateProjectResult } from "./projects.ts";
export { WorktreeManager } from "./worktree.ts";
export { resolveManifest, sha256, type ResolvedManifest } from "./manifest-resolver.ts";
export { ManifestApprovalStore, gateManifest, type ManifestApprovalInput, type ManifestApprovalRecord, type ManifestGate } from "./manifest-approval.ts";
export { copyIncludedFiles, DEFAULT_INCLUDE_LIMITS, type IncludeCopyReport, type IncludeCopyLimits } from "./include-copy.ts";
export {
  WorkspaceRuntime,
  foldWorkspaceState,
  type WorkspaceEmit,
  type WorkspaceRunInput,
  type WorkspaceRunResult,
  type WorkspaceOperationKind,
  type FoldedWorkspaceState,
} from "./workspace-runtime.ts";
export {
  pruneWorktrees,
  scanWorktrees,
  type PruneResult,
  type WorktreeEntry,
  type WorktreeSessionRow,
  type WorktreeState,
} from "./worktree-hygiene.ts";
