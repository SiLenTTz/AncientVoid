/** Public API of this module (ADR-0020). Other modules import only from here. */
export { discoverProjects, isProjectPathAllowed, type DiscoveredProject, type ProjectDiscoveryResult } from "./projects.ts";
export { WorktreeManager } from "./worktree.ts";
export {
  pruneWorktrees,
  scanWorktrees,
  type PruneResult,
  type WorktreeEntry,
  type WorktreeSessionRow,
  type WorktreeState,
} from "./worktree-hygiene.ts";
