/** Public API of this module (ADR-0020). Other modules import only from here. */
export { previousOccurrence, expandCronField, nextOccurrences, scheduleToFields, wallToUtcInstants } from "./schedule.ts";
export { AutomationStore, CLAIM_HISTORY_KEEP, type ClaimState, type JournalEvent } from "./store.ts";
export { AutomationsScheduler, type AutomationsDeps, type DispatchResult, type ExecutionStatus, type PrecheckResult } from "./scheduler.ts";
export { AutomationService, type AutomationServiceDeps, type AutomationLauncher, type AutomationPrechecker } from "./service.ts";
