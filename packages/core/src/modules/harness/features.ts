import type { HarnessFeatures, SessionSpec, SteerInput } from "@ancientvoid/contracts";

/**
 * ADR-0018: the server refuses what a harness can't do, before the adapter
 * sees it — a hidden button protects nothing. Returns the reason in words,
 * or null when the request fits.
 *
 * Skills are not checked here: the hub puts a skill chain in front of any
 * prompt itself (T5.x); `features.skills` only names native invocation.
 */
export function refuseSpec(features: HarnessFeatures, adapter: string, spec: Pick<SessionSpec, "model" | "args" | "attachments">): string | null {
  if (spec.model && features.modelChoice === "none") return `${adapter} kann beim Start kein Modell wählen.`;
  // AC-P7-4: an observer takes no input — its attachments would vanish.
  if (spec.attachments?.length && !features.followUp && !features.interrupt) return `${adapter} beobachtet nur — Anhänge kommen dort nicht an.`;
  const mode = (spec.args as { permissionMode?: unknown } | undefined)?.permissionMode;
  if (typeof mode === "string" && mode && !features.permissionModes.includes(mode)) return `${adapter} kennt den Modus „${mode}“ nicht.`;
  const agent = (spec.args as { agent?: unknown } | undefined)?.agent;
  if (typeof agent === "string" && agent && !features.agents) return `${adapter} kennt keine Agenten.`;
  return null;
}

export function refuseSteer(features: HarnessFeatures, adapter: string, input: SteerInput): string | null {
  if (input.kind === "prompt" && !features.followUp) return `${adapter} nimmt keine weiteren Eingaben an.`;
  if (input.kind === "park" && !features.interrupt) return `${adapter} kann einen laufenden Zug nicht anhalten.`;
  if (input.kind === "configure") {
    if (input.model === undefined && input.permissionMode === undefined) return "Nichts zu ändern.";
    if (input.model !== undefined && !features.modelSwitch) return `${adapter} kann das Modell nach dem Start nicht wechseln.`;
    if (input.permissionMode !== undefined && !features.permissionModes.includes(input.permissionMode))
      return `${adapter} kennt den Modus „${input.permissionMode}“ nicht.`;
  }
  return null;
}
