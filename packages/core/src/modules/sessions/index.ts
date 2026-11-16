/** Public API of this module (ADR-0020). Other modules import only from here. */
export { SessionManager, type AdapterUsageSnapshot, type SessionManagerObservability } from "./session-manager.ts";
export { sessionTitle } from "./session-state.ts";
export { DraftStore, type SaveDraftResult } from "./drafts.ts";
export { describeToolInput, type ToolGate } from "./tool-permissions.ts";
export { createTokenTally, tokenTotalsOf, type SessionTokenTotals, type TokenTally } from "./token-totals.ts";
