import { AutomationInfo, AutomationHistoryEntry, ExternalJobsResponse } from "@ancientvoid/contracts";
import { sha256Hex } from "./automation-labels.ts";

export interface AutomationSnapshot {
  at: string;
  list: AutomationInfo[];
  histories: { id: string; at: string; entries: AutomationHistoryEntry[] }[];
  /** EPIC-P73 (ADR-0094): externe Auto-Jobs — mit eigenem Zeitstempel, weil
   * ihr Frischversuch unabhängig von der Automationen-Liste fehlschlagen
   * kann (K10: ein Cache beweist niemals aktuellen Erfolg). */
  external?: ExternalJobsResponse;
}

/** K10: keine Token-Klartexte und kein Vermischen von Peer-/Geräteprojektionen.
 * v2 seit EPIC-P73: external-Sektion dazu (alte v1-Kopien werden ignoriert). */
export async function automationCacheKey(scope: string, token: string): Promise<string> {
  return `ancientvoid.automations.v2:${scope}:${await sha256Hex(token)}`;
}

export function readAutomationSnapshot(key: string): AutomationSnapshot | null {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (!raw || typeof raw !== "object") return null;
    const data = raw as Record<string, unknown>;
    if (typeof data.at !== "string" || !Number.isFinite(Date.parse(data.at)) || !Array.isArray(data.histories)) return null;
    const list = AutomationInfo.array().parse(data.list);
    const histories = data.histories.map((item: { id: string; at: string; entries: unknown }) => ({ id: item.id, at: item.at, entries: AutomationHistoryEntry.array().parse(item.entries) }));
    const external = data.external === undefined ? undefined : ExternalJobsResponse.parse(data.external);
    return { at: data.at, list, histories, ...(external !== undefined ? { external } : {}) };
  } catch (err) { console.warn("Automations-Offlinekopie nicht lesbar", err); return null; }
}

export function writeAutomationSnapshot(key: string, snapshot: AutomationSnapshot): void {
  try { localStorage.setItem(key, JSON.stringify(snapshot)); }
  catch (err) { console.warn("Automations-Offlinekopie nicht speicherbar", err); }
}
