import { describe, expect, it } from "vitest";
import type { DiscoveredSession } from "../../../src/shared/api.ts";
import { groupDiscovery } from "../../../src/features/discovery/groups.ts";

function item(partial: Partial<DiscoveredSession> & Pick<DiscoveredSession, "observedAt" | "project">): DiscoveredSession {
  return {
    hubSessionId: null,
    adapter: "opencode",
    status: "observed",
    controlMode: "observed",
    harness: "cli",
    hostId: "local",
    nativeSessionId: partial.project + partial.observedAt,
    resumeVersion: 1,
    unsupportedResume: false,
    fork: false,
    parentSessionId: null,
    ...partial,
  } as DiscoveredSession;
}

describe("groupDiscovery", () => {
  it("groups by project name, newest project first, its sessions newest first", () => {
    const groups = groupDiscovery([
      item({ project: "/repos/alt-proj", observedAt: "2026-09-20T10:00:00.000Z" }),
      item({ project: "/repos/harnez/sub", observedAt: "2026-09-28T14:00:00.000Z" }),
      item({ project: "/repos/harnez/sub", observedAt: "2026-09-28T09:00:00.000Z" }),
      item({ project: "/repos/mobile-hub", observedAt: "2026-09-28T13:00:00.000Z" }),
    ]);
    expect(groups.map((g) => g.project)).toEqual(["sub", "mobile-hub", "alt-proj"]);
    expect(groups[0]!.newestAt).toBe("2026-09-28T14:00:00.000Z");
    expect(groups[0]!.sessions.map((s) => s.observedAt)).toEqual(["2026-09-28T14:00:00.000Z", "2026-09-28T09:00:00.000Z"]);
  });

  it("sessions of the same repo merge into one group, whatever their source path", () => {
    const groups = groupDiscovery([
      item({ project: "/mnt/omarchy_data/30_repos/arch/arbeitsbaeume/securesight-harnez", observedAt: "2026-09-28T14:00:00.000Z" }),
      item({ project: "/mnt/omarchy_data/30_repos/arch/arbeitsbaeume/securesight-harnez", observedAt: "2026-09-28T12:00:00.000Z" }),
      item({ project: "/mnt/omarchy_data/30_repos/arch/arbeitsbaeume/mobile-hub", observedAt: "2026-09-28T13:00:00.000Z" }),
    ]);
    expect(groups.map((g) => g.project)).toEqual(["securesight-harnez", "mobile-hub"]);
    expect(groups[0]!.sessions).toHaveLength(2);
  });
});
