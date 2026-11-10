import { describe, expect, it } from "vitest";
import {
  AutomationClaimState,
  AutomationDefinition,
  AutomationGrant,
  AutomationSchedule,
  AutomationTarget,
  automationClaimKey,
  cronFieldValid,
  cronSubsetValid,
  policyFor,
} from "@ancientvoid/contracts";

const base = {
  id: "3f6b1c2e-3a1e-4d02-9d6e-5f5c4b4a3928",
  label: "Nachtjob",
  generation: 1,
  hostId: "omarchy",
  createdAtUtc: "2026-11-12T00:00:00.000Z",
};
const target = { kind: "session", harness: "pi", workdir: "worktree", project: "/srv/repo", promptBlobSha256: "a".repeat(64) };

describe("automation contracts (T41.1 / ADR-0064)", () => {
  it("accepts presets and the limited 5-field cron with explicit IANA timezone", () => {
    expect(AutomationSchedule.safeParse({ kind: "preset", preset: "daily", localTime: "03:15", timezone: "Europe/Berlin" }).success).toBe(true);
    expect(AutomationSchedule.safeParse({ kind: "preset", preset: "weekly", localTime: "06:00", weekdays: [1, 3], timezone: "Europe/Berlin" }).success).toBe(true);
    expect(AutomationSchedule.safeParse({ kind: "cron", cron: "15 9 * * 1-5", timezone: "America/New_York" }).success).toBe(true);
    expect(cronFieldValid("*/15", 0, 59)).toBe(true);
    expect(cronFieldValid("5-10/2,59", 0, 59)).toBe(true);
  });

  it("rejects what the limited subset excludes: names, L/W/#, 6 fields, missing timezone, bad bounds", () => {
    expect(cronSubsetValid("0 9 * * MON")).toBe(false);
    expect(cronSubsetValid("0 0 L * *")).toBe(false);
    expect(cronSubsetValid("0 0 1 1 ? 2")).toBe(false);
    expect(cronFieldValid("7", 0, 6)).toBe(false);
    expect(cronFieldValid("60", 0, 59)).toBe(false);
    expect(AutomationSchedule.safeParse({ kind: "preset", preset: "daily", localTime: "03:15" }).success).toBe(false);
    expect(AutomationSchedule.safeParse({ kind: "preset", preset: "daily", localTime: "03:15", timezone: "Mitteleuropa" }).success).toBe(false);
    expect(AutomationSchedule.safeParse({ kind: "preset", preset: "daily", localTime: "24:00", timezone: "Europe/Berlin" }).success).toBe(false);
  });

  it("starts disabled with a one-slot frame (new things start disabled, AC-P41-4)", () => {
    const parsed = AutomationDefinition.parse({ ...base, schedule: { kind: "preset", preset: "hourly", timezone: "Europe/Berlin" }, target });
    expect(parsed.enabled).toBe(false);
    expect(parsed.generation).toBe(1);
    expect(parsed.grant).toEqual({ maxParallel: 1, missedGraceMs: 0 });
    expect(AutomationGrant.parse({}).missedGraceMs).toBe(0);
  });

  it("lässt den Prompt nur als Blob-Verweis zu — Zielvertrag hält dicht (K5)", () => {
    // wie die übrigen Contracts: Unbekanntes wird gestrippt — der Prompt lebt im Blob, hier nur der Verweis.
    expect("prompt" in AutomationTarget.parse({ ...target, prompt: "mach das" })).toBe(false);
    expect(AutomationTarget.safeParse({ kind: "session", harness: "pi", workdir: "worktree", project: "/srv/repo" }).success).toBe(false);
    expect(AutomationTarget.safeParse({ ...target, promptBlobSha256: "hi" }).success).toBe(false);
    expect(AutomationTarget.safeParse({ kind: "run", templateId: "nightly" }).success).toBe(true);
  });

  it("claim key is deterministic over schedule+generation+occurrence (UTC)", () => {
    const key = automationClaimKey(base.id, 2, "2026-11-13T03:15:00.000Z");
    expect(key).toBe(`${base.id}:2:2026-11-13T03:15:00.000Z`);
    expect(automationClaimKey(base.id, 3, "2026-11-13T03:15:00.000Z")).not.toBe(key);
    expect(AutomationClaimState.options).toContain("dispatched");
    expect(AutomationClaimState.options).not.toContain("succeeded");
  });

  it("policy: humans and the human's phone decide; agents never activate or run-now", () => {
    expect(policyFor("automations.manage", "pixel-9")).toBe("allow");
    expect(policyFor("automations.manage", "fleet:omarchy")).toBe("allow");
    expect(policyFor("automations.runNow", "pixel-9")).toBe("allow");
    expect(policyFor("automations.runNow", "fleet:omarchy")).toBe("allow");
    for (const op of ["automations.manage", "automations.runNow"] as const) {
      expect(policyFor(op, "agent:mcp"), op).toBe("deny");
      expect(policyFor(op, "bridge:s1"), op).toBe("deny");
      expect(policyFor(op, "companion:omarchy"), op).toBe("deny");
      expect(policyFor(op, "display:nyx"), op).toBe("deny");
    }
  });
});
