import { describe, expect, it } from "vitest";
import { Team } from "@ancientvoid/contracts";
import { readTeamSnapshot, teamCacheKey, writeTeamSnapshot } from "../../../src/features/team/team-cache.ts";

const mem = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => mem.get(key) ?? null,
    setItem: (key: string, value: string) => void mem.set(key, value),
    removeItem: (key: string) => void mem.delete(key),
  },
});

function team(id: string): Team {
  return {
    id,
    title: `Team ${id}`,
    goal: "Ziel",
    project: "/tmp/p",
    frame: { adapters: ["dummy"], coordinatorAdapter: null, models: ["m1"], maxTasks: 8, maxDispatchesPerTask: 2, maxParallel: 2 },
    planSource: "given",
    coordinatorSessionId: null,
    status: "done",
    tasks: [],
    gates: [],
    deliveries: [],
    createdAt: "2026-11-14T10:00:00.000Z",
    updatedAt: "2026-11-14T10:05:00.000Z",
    endedAt: null,
  };
}

describe("EPIC-P60 — Teams-Offlinekopie (K10)", () => {
  it("schreibt und liest einen Snapshot formtreu zurück", () => {
    const key = "ancientvoid.teams.v1:test:k";
    writeTeamSnapshot(key, { at: "2026-11-14T12:00:00.000Z", list: [team("t-1"), team("t-2")] });
    const back = readTeamSnapshot(key);
    expect(back?.at).toBe("2026-11-14T12:00:00.000Z");
    expect(back?.list.map((t) => t.id)).toEqual(["t-1", "t-2"]);
    expect(back?.list[0]?.frame.models).toEqual(["m1"]);
    localStorage.removeItem(key);
  });

  it("verwirft unlesbare/kaputte Kopien fail-loud-ersatzweise als null (nie halbe Projektion)", () => {
    localStorage.setItem("ancientvoid.teams.v1:test:x", "{kaputt");
    expect(readTeamSnapshot("ancientvoid.teams.v1:test:x")).toBeNull();
    localStorage.setItem("ancientvoid.teams.v1:test:y", JSON.stringify({ at: "not-a-date", list: [] }));
    expect(readTeamSnapshot("ancientvoid.teams.v1:test:y")).toBeNull();
    localStorage.removeItem("ancientvoid.teams.v1:test:x");
    localStorage.removeItem("ancientvoid.teams.v1:test:y");
  });

  it("Cache-Schlüssel enthält Scope und Token-Hash, nie den Token-Klartext", async () => {
    const key = await teamCacheKey("/api/teams", "geheim-token");
    expect(key).toContain("/api/teams");
    expect(key).not.toContain("geheim-token");
    expect(key.length).toBeGreaterThan("/api/teams".length + 10);
  });
});
