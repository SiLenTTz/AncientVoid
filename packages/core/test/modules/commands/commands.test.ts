import { describe, expect, it } from "vitest";
import { CommandContext } from "@uacc/contracts";
import { planCommand } from "../../../src/index.ts";
import { CASES, DATA, type Expect } from "./eval-set.ts";

function verdict(plan: Awaited<ReturnType<typeof planCommand>>, want: Expect): string | null {
  if ("none" in want) return plan.steps.length === 0 && !plan.question ? null : `erwartet nichts, bekam ${plan.steps[0]?.op ?? `Frage ${plan.question?.param}`}`;
  if ("refusal" in want) return plan.refusal && plan.steps.length === 0 ? null : `erwartet Ablehnung, bekam ${plan.steps[0]?.op ?? plan.question?.param ?? "nichts"}`;
  if ("question" in want) return plan.question?.param === want.question ? null : `erwartet Frage ${want.question}, bekam ${plan.steps[0]?.op ?? plan.question?.param ?? plan.refusal}`;
  const step = plan.steps[0];
  if (!step || step.op !== want.op) return `erwartet ${want.op}, bekam ${step?.op ?? (plan.question ? `Frage ${plan.question.param}` : plan.refusal)}`;
  for (const [k, v] of Object.entries(want.args ?? {})) if (step.args[k] !== v) return `${want.op}: ${k}=${String(step.args[k])} statt ${String(v)}`;
  return null;
}

describe("command planner — evaluation set (T9.5, AC-P9-2)", () => {
  it(`≥ 100 formulations, ≥ 95 % right (${CASES.length} cases), zero unasked risky actions`, async () => {
    const misses: string[] = [];
    let riskyWrong = 0;
    for (const [text, ctx, want] of CASES) {
      const plan = await planCommand(text, CommandContext.parse(ctx), DATA);
      const v = verdict(plan, want);
      if (v) {
        misses.push(`„${text}“ → ${v}`);
        // A write step where none (or another) was expected is the dangerous kind.
        if (plan.steps.some((s) => s.risk !== "read") && (!("op" in want) || want.op !== plan.steps[0]!.op)) riskyWrong++;
      }
    }
    const rate = (CASES.length - misses.length) / CASES.length;
    console.log(`planner: ${CASES.length - misses.length}/${CASES.length} = ${(rate * 100).toFixed(1)} %\n${misses.join("\n")}`);
    expect(CASES.length).toBeGreaterThanOrEqual(100);
    expect(riskyWrong).toBe(0);
    expect(rate).toBeGreaterThanOrEqual(0.95);
  });
});
