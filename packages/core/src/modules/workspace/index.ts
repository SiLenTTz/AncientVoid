/** Public API of this module (ADR-0020). Other modules import only from here. */
export { discoverProjects, isProjectPathAllowed, type DiscoveredProject, type ProjectDiscoveryResult } from "./projects.ts";
export { WorktreeManager } from "./worktree.ts";
