/** Public API of this module (ADR-0020). Other modules import only from here. */
export { createGlabRunner, glabApiJson, glabApiText, fetchAllPages, GitLabApiError, type GlabRunner, type GlabRunResult, type GlabErrorKind, type PagedResult } from "./gitlab-client.ts";
export {
  parseRemoteUrl,
  parseMrUrl,
  remoteUrl,
  currentBranch,
  headSha,
  commitsAhead,
  remoteBranchSha,
  pushBranch,
  type RemoteIdentity,
  type MrUrlIdentity,
} from "./remote.ts";
export {
  resolveProject,
  encodeProjectId,
  fetchMr,
  fetchPipelines,
  fetchJobs,
  fetchThreads,
  fetchIssues,
  fetchTrace,
  findMrsBySourceBranch,
  mapMr,
  mapPipeline,
  mapJob,
  mapBridge,
  mapThread,
  mapIssue,
} from "./gitlab-reader.ts";
export { ForgeStore } from "./forge-store.ts";
export { composeForgeFeedbackPrompt, shaDrifted, type ForgeFeedbackSource } from "./feedback.ts";
