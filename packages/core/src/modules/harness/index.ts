/** Public API of this module (ADR-0020). Other modules import only from here. */
export { HARNESS_CATALOG, nativeOpenCommand, probeHarnesses, spawnProbeRunner, type ProbeRunner, type ProbeRun } from "./inventory.ts";
export { AdapterRegistry, type RegisteredAdapter } from "./registry.ts";
export { refuseSpec, refuseSteer } from "./features.ts";
