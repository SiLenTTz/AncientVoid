import type { HarnessFeatures, ToolGate } from "./api.ts";

/** ADR-0018: how a harness releases tool calls, in words. */
export const TOOL_GATE_LABEL: Record<ToolGate, string> = {
  native: "fragt pro Tool",
  sandbox: "Tools in Sandbox, ohne Nachfrage",
  allowlist: "feste Tool-Liste, ohne Nachfrage",
  bypass: "Tools laufen ungefragt",
  none: "keine Tools",
};

/** The functions a harness offers, for chips. */
export function featureChips(f: HarnessFeatures): string[] {
  const chips: [boolean, string][] = [
    [f.followUp, "Folgeprompt"],
    [f.interrupt, "Anhalten"],
    [f.questions, "Rückfragen"],
    [f.modelChoice === "start", "Modellwahl"],
    [f.agents, "Agenten"],
    [f.skills, "Skills"],
    [f.images, "Bilder"],
    [f.files, "Dateien"],
    [f.contextFork, "Abzweig"],
  ];
  return chips.filter(([on]) => on).map(([, label]) => label);
}
