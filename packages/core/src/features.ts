import type { HarnessFeatures, SessionSpec, SteerInput } from "@uacc/contracts";

/**
 * ADR-0018: the server refuses what a harness can't do, before the adapter
 * sees it — a hidden button protects nothing. Returns the reason in words,
 * or null when the request fits.
 *
 * Skills are not checked here: the hub puts a skill chain in front of any
 * prompt itself (T5.x); `features.skills` only names native invocation.
 */
export function refuseSpec(features: HarnessFeatures, adapter: string, spec: Pick<SessionSpec, "model" | "args">): string | null {
  if (spec.model && features.modelChoice === "none") return `${adapter} kann beim Start kein Modell wählen.`;
  const agent = (spec.args as { agent?: unknown } | undefined)?.agent;
  if (typeof agent === "string" && agent && !features.agents) return `${adapter} kennt keine Agenten.`;
  return null;
}

export function refuseSteer(features: HarnessFeatures, adapter: string, input: SteerInput): string | null {
  if (input.kind === "prompt" && !features.followUp) return `${adapter} nimmt keine weiteren Eingaben an.`;
  if (input.kind === "park" && !features.interrupt) return `${adapter} kann einen laufenden Zug nicht anhalten.`;
  return null;
}
