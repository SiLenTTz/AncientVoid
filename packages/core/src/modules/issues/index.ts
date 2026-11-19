export { GitHubClient, resolveGitHubTokenFile, type IssueView, type WorkflowRunView, type GitHubClientDeps } from "./github-client.ts";
export { IssueBridgeJournal, BRIDGE_ENTRY_KEEP, BRIDGE_ERROR_KEEP, type BridgeEntry, type BridgeOutcome } from "./issue-journal.ts";
export {
  IssueSessionBridge,
  BRIDGE_POLL_DEFAULT_MS,
  buildIssuePrompt,
  type IssueBridgeConfig,
  type IssueBridgeDeps,
  type BridgeSessions,
  type BridgeClient,
} from "./issue-bridge.ts";
