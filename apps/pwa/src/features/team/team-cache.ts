import { Team } from "@ancientvoid/contracts";
import { sha256Hex } from "../automations/automation-labels.ts";

export interface TeamSnapshot {
  at: string;
  list: Team[];
}

/** K10: keine Token-Klartexte und kein Vermischen von Peer-/Geräteprojektionen (Muster automation-cache). */
export async function teamCacheKey(scope: string, token: string): Promise<string> {
  return `ancientvoid.teams.v1:${scope}:${await sha256Hex(token)}`;
}

export function readTeamSnapshot(key: string): TeamSnapshot | null {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (!raw || typeof raw !== "object") return null;
    const data = raw as Record<string, unknown>;
    if (typeof data.at !== "string" || !Number.isFinite(Date.parse(data.at))) return null;
    return { at: data.at, list: Team.array().parse(data.list) };
  } catch (err) {
    console.warn("Teams-Offlinekopie nicht lesbar", err);
    return null;
  }
}

export function writeTeamSnapshot(key: string, snapshot: TeamSnapshot): void {
  try {
    localStorage.setItem(key, JSON.stringify(snapshot));
  } catch (err) {
    console.warn("Teams-Offlinekopie nicht speicherbar", err);
  }
}
