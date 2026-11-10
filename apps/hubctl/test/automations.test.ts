import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { buildAutomationDefinition, formatAutomationLine, type AutomationInfo } from "../src/automations.ts";

/** EPIC-P41 T41.5: Definitions- und Format-Helfer des hubctl-automations-Commands. */

const SESSION_JSON = {
  label: "Morgen-Briefing",
  hostId: "host-a",
  schedule: { kind: "cron", cron: "30 8 * * *", timezone: "Europe/Berlin" },
  target: { kind: "session", harness: "dummy", workdir: "worktree", project: "/tmp/repo", promptBlobSha256: "" },
  precheckDeadlineMs: 60_000,
  grant: { maxParallel: 1, missedGraceMs: 0 },
};

describe("buildAutomationDefinition", () => {
  it("ergänzt id/generation/enabled/createdAt und setzt den Prompt-Blob-Verweis (K5)", () => {
    const def = buildAutomationDefinition(JSON.stringify(SESSION_JSON), "Mein Prompt") as Record<string, never> as {
      id: string; generation: number; enabled: boolean; createdAtUtc: string;
      target: { promptBlobSha256: string };
    };
    expect(def.id.length).toBeGreaterThan(10);
    expect(def.generation).toBe(1);
    expect(def.enabled).toBe(false); // Neuanfang-Zustand: Aktivierung ist die separate Freigabe.
    expect(def.createdAtUtc.length).toBeGreaterThanOrEqual(20);
    expect(def.target.promptBlobSha256).toBe(createHash("sha256").update("Mein Prompt").digest("hex"));
  });

  it("übernimmt vorhandene id/createdAt und lässt Run-Ziele ohne Prompt zu", () => {
    const def = buildAutomationDefinition(
      JSON.stringify({ ...SESSION_JSON, id: "fest-1", createdAtUtc: "2026-11-12T08:00:00.000Z", target: { kind: "run", templateId: "tpl-1" } }),
      null,
    ) as { id: string; createdAtUtc: string; target: { kind: string } };
    expect(def.id).toBe("fest-1");
    expect(def.createdAtUtc).toBe("2026-11-12T08:00:00.000Z");
    expect(def.target.kind).toBe("run");
  });

  it("verweigert Session-Ziel ohne Prompt-Text und ohne vorhandenen Blob-Verweis", () => {
    expect(() => buildAutomationDefinition(JSON.stringify(SESSION_JSON), null)).toThrow(/Prompt-Text/);
  });

  it("verweigert kaputtes JSON und Ziel ohne kind", () => {
    expect(() => buildAutomationDefinition("{kein json", null)).toThrow(/ungültig/);
    expect(() => buildAutomationDefinition(JSON.stringify({ label: "x" }), null)).toThrow(/target/);
  });
});

describe("formatAutomationLine", () => {
  const info: AutomationInfo = {
    definition: {
      id: "0123456789abcdef", label: "Morgen-Briefing", generation: 1, enabled: true, hostId: "host-a",
      schedule: { kind: "cron", cron: "30 8 * * *", timezone: "Europe/Berlin" },
      target: { kind: "session", harness: "dummy", project: "/tmp/repo" },
      grant: { maxParallel: 1, missedGraceMs: 0 }, createdAtUtc: "2026-11-12T07:00:00.000Z",
    },
    nextOccurrences: [{ utc: "2026-11-13T07:30:00.000Z", local: "2026-11-13 08:30" }],
    lastOccurrence: { utc: "2026-11-12T07:30:00.000Z", state: "dispatched", sessionId: "s-1" },
  };

  it("zeigt Label, Zustand, Plan, Zeitzone, nächsten Termin und letztes Ergebnis", () => {
    const line = formatAutomationLine(info);
    expect(line).toContain("an");
    expect(line).toContain("Morgen-Briefing");
    expect(line).toContain("30 8 * * *");
    expect(line).toContain("Europe/Berlin");
    expect(line).toContain("2026-11-13T07:30:00.000Z");
    expect(line).toContain("dispatched");
  });

  it("zeigt aus/Striche bei frischer deaktivierter Automation", () => {
    const line = formatAutomationLine({
      ...info,
      definition: { ...info.definition, enabled: false },
      nextOccurrences: [],
      lastOccurrence: null,
    });
    expect(line).toContain("aus");
    expect(line).toContain("next —");
    expect(line).toContain("last —");
  });
});
