import type { CommandContext, CommandPlan } from "@uacc/contracts";
import { parseCommand, type Intent } from "./parse.ts";
import { resolveIntent, type ResolveData } from "./resolve.ts";
import { askPlannerModel, type PlannerModelConfig } from "./model.ts";

export type Planned = Omit<CommandPlan, "id" | "createdAt">;

/**
 * T9.2: rules first (fast, local, always there); the local model only for
 * what the rules do not know. A failing model is a clear message — the
 * buttons keep working (AC-P9-5).
 */
export async function planCommand(text: string, context: CommandContext, data: ResolveData, opts: { model?: PlannerModelConfig | undefined; answers?: Record<string, string>; intent?: Intent } = {}): Promise<Planned> {
  const base = { text, context, steps: [] as Planned["steps"], question: null, refusal: null };
  let intent = opts.intent;
  let planner: Planned["planner"] = "rules";
  if (!intent) {
    const parsed = parseCommand(text);
    if (parsed.kind === "refusal") return { ...base, planner: "rules", refusal: parsed.reason };
    if (parsed.kind === "intent") intent = parsed.intent;
  }
  if (!intent && opts.model) {
    try {
      intent = (await askPlannerModel(opts.model, text, context)) ?? undefined;
      planner = "model";
    } catch (err) {
      return { ...base, planner: "none", refusal: `Nicht verstanden, und das lokale Modell ist nicht erreichbar (${err instanceof Error ? err.message.slice(0, 60) : "Fehler"}) — bitte über die Knöpfe.` };
    }
  }
  if (!intent) return { ...base, planner: opts.model ? "model" : "none", refusal: "Nicht verstanden. Versuch z. B. „Zeig wartende Sessions“, „Starte Codex in alpha: …“, „Antworte dort: …“." };
  const resolved = resolveIntent(intent, context, data, opts.answers);
  return { ...base, planner, ...resolved };
}
