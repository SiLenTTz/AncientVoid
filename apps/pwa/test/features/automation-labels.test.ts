import { describe, expect, it } from "vitest";
import { AutomationClaimState, AutomationOutcome, AUTOMATION_SKIP_REASONS } from "@ancientvoid/contracts";
import { REASON_LABEL, STATE_LABEL, outcomeLabel } from "../../src/features/automations/automation-labels.ts";

/** EPIC-P41 AC-P41-4: jeder Contract-Grund/-Zustand ist in der PWA getrennt beschriftet — nie roher Code, nie ein Sammelgrund. */
describe("Automationen: Beschriftungen decken den Contract ab", () => {
  it("jeder Skip-Grund hat eine eigene Beschriftung", () => {
    for (const reason of AUTOMATION_SKIP_REASONS) expect(REASON_LABEL[reason], reason).toBeTruthy();
    expect(new Set(AUTOMATION_SKIP_REASONS.map(r => REASON_LABEL[r])).size).toBe(AUTOMATION_SKIP_REASONS.length);
  });

  it("jeder Claim-Zustand und jedes Ergebnis hat eine Beschriftung", () => {
    for (const state of AutomationClaimState.options) expect(STATE_LABEL[state], state).toBeTruthy();
    for (const outcome of AutomationOutcome.options) expect(outcomeLabel(outcome), outcome).not.toBe(outcome);
  });
});
