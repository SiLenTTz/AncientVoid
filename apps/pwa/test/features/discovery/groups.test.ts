import { describe, expect, it } from "vitest";
import type { DiscoveredSession } from "../../../src/shared/api.ts";
import { adapterCounts, discoveryState, filterDiscovery, groupDiscovery, stateCounts, TEMPORARY_GROUP } from "../../../src/features/discovery/groups.ts";

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
      item({ project: "/repos/AncientVoid", observedAt: "2026-09-28T13:00:00.000Z" }),
    ]);
    expect(groups.map((g) => g.project)).toEqual(["sub", "AncientVoid", "alt-proj"]);
    expect(groups[0]!.newestAt).toBe("2026-09-28T14:00:00.000Z");
    expect(groups[0]!.sessions.map((s) => s.observedAt)).toEqual(["2026-09-28T14:00:00.000Z", "2026-09-28T09:00:00.000Z"]);
  });

  it("sessions of the same repo merge into one group, whatever their source path", () => {
    const groups = groupDiscovery([
      item({ project: "/mnt/data/30_repos/arch/arbeitsbaeume/securesight-harnez", observedAt: "2026-09-28T14:00:00.000Z" }),
      item({ project: "/mnt/data/30_repos/arch/arbeitsbaeume/securesight-harnez", observedAt: "2026-09-28T12:00:00.000Z" }),
      item({ project: "/mnt/data/30_repos/arch/arbeitsbaeume/AncientVoid", observedAt: "2026-09-28T13:00:00.000Z" }),
    ]);
    expect(groups.map((g) => g.project)).toEqual(["securesight-harnez", "AncientVoid"]);
    expect(groups[0]!.sessions).toHaveLength(2);
  });

  it("EPIC-P34: temporäre Sessions stehen gesammelt am Ende, auch wenn sie die neuesten sind; der Zähler bleibt", () => {
    const groups = groupDiscovery([
      item({ project: "/repos/App", observedAt: "2026-11-01T10:00:00.000Z" }),
      item({ project: "/tmp/a", observedAt: "2026-11-07T10:00:00.000Z", temporary: true }),
      item({ project: "/tmp/b", observedAt: "2026-11-07T09:00:00.000Z", temporary: true }),
    ]);
    expect(groups.map((g) => g.project)).toEqual(["App", TEMPORARY_GROUP]);
    expect(groups[1]).toMatchObject({ temporary: true });
    expect(groups[1]!.sessions).toHaveLength(2);
  });

  it("EPIC-P34: Subagenten hängen an ihrer Hauptsession statt als eigene Karte", () => {
    const main = item({ project: "/repos/App", observedAt: "2026-11-07T10:00:00.000Z", nativeSessionId: "main1" });
    const sub = item({ project: "/repos/App", observedAt: "2026-11-07T10:05:00.000Z", nativeSessionId: "agent-1", parentSessionId: "main1" });
    const orphan = item({ project: "/repos/App", observedAt: "2026-11-06T10:00:00.000Z", nativeSessionId: "agent-2", parentSessionId: "weg" });
    const [group] = groupDiscovery([main, sub, orphan]);
    expect(group!.sessions.map((s) => s.nativeSessionId)).toEqual(["main1", "agent-2"]);
    expect(group!.subagents.main1!.map((s) => s.nativeSessionId)).toEqual(["agent-1"]);
    // Der Zähler der Gruppe zählt alles Gefundene, auch die versteckten Subagenten.
    expect(group!.total).toBe(3);
  });
});

describe("Kennzahlen und Filter (EPIC-P34 T34.9)", () => {
  const base = { observedAt: "2026-11-07T10:00:00.000Z", project: "/r/App" };
  const items = [
    item({ ...base, nativeSessionId: "a", adapter: "claude", live: true }),
    item({ ...base, nativeSessionId: "b", adapter: "claude" }),
    item({ ...base, nativeSessionId: "c", adapter: "codex", unsupportedResume: true }),
    item({ ...base, nativeSessionId: "d", adapter: "claude", hubSessionId: "hub-1", live: true }),
    item({ ...base, nativeSessionId: "e", adapter: "pi", status: "unsupported-format", unsupportedResume: true }),
  ];

  it("jede Session hat genau einen Zustand; unbekanntes Format und Hub gehen vor live", () => {
    expect(items.map(discoveryState)).toEqual(["live", "resumable", "observed", "hub", "unknown"]);
  });

  it("zählt je Zustand und je Provider (größter zuerst)", () => {
    expect(stateCounts(items)).toEqual({ live: 1, resumable: 1, observed: 1, hub: 1, unknown: 1 });
    expect(adapterCounts(items)).toEqual([{ adapter: "claude", count: 3 }, { adapter: "codex", count: 1 }, { adapter: "pi", count: 1 }]);
  });

  it("filtert nach Zustand und nach Providern; ohne Auswahl bleibt alles", () => {
    expect(filterDiscovery(items, { state: null, adapters: new Set() })).toHaveLength(5);
    expect(filterDiscovery(items, { state: "live", adapters: new Set() }).map((i) => i.nativeSessionId)).toEqual(["a"]);
    expect(filterDiscovery(items, { state: null, adapters: new Set(["codex", "pi"]) }).map((i) => i.nativeSessionId)).toEqual(["c", "e"]);
    expect(filterDiscovery(items, { state: "resumable", adapters: new Set(["codex"]) })).toEqual([]);
  });
});
