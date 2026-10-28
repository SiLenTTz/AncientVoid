/** Public API of this module (ADR-0020). Other modules import only from here. */
export { buildHandoverPrompt, redactSecrets, HANDOVER_PROMPT_MAX, type HandoverContext } from "./build.ts";
