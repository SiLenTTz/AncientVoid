/** Public API of this module (ADR-0020). Other modules import only from here. */
export { LoopRegistry, NOT_CONFIGURED_REASON, toStartSpec } from "./registry.ts";
export { loopAsAdapter } from "./loop-adapter.ts";
export { loadLoops } from "./load.ts";
