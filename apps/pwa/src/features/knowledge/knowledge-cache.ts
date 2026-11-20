import type { KnowledgeHit, KnowledgeOverview, KnowledgeSourceView } from "@ancientvoid/contracts";

/**
 * EPIC-P74 T74.6 (K10, Muster Automations/P49): Offline-Kopie der letzten
 * Übersicht. Ein Cache beweist niemals aktuellen Erfolg — die Oberfläche zeigt
 * seinen Zeitstempel und sperrt Aktionen offline. Keine Geheimnisse: Die
 * Quell-Liste trägt nur `hasSecret`, nie das Geheimnis selbst (ADR-0096 §4).
 */

export interface KnowledgeSnapshot {
  at: string;
  sources: KnowledgeSourceView[];
  overview?: KnowledgeOverview;
  query?: { q: string; topK?: number; fusion?: "sequential" | "rrf"; minScore?: number };
  hits?: { items: KnowledgeHit[]; truncated: boolean };
}

const KEY = "ancientvoid.knowledge.v1";

function sourceOf(raw: unknown): KnowledgeSourceView | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  const status = s.status as Record<string, unknown> | undefined;
  if (typeof s.id !== "string" || typeof s.label !== "string" || !status || typeof status.state !== "string") return null;
  return raw as KnowledgeSourceView;
}

export function readKnowledgeSnapshot(): KnowledgeSnapshot | null {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!raw || typeof raw !== "object") return null;
    const data = raw as Record<string, unknown>;
    if (typeof data.at !== "string" || !Number.isFinite(Date.parse(data.at)) || !Array.isArray(data.sources)) return null;
    const sources = data.sources.map(sourceOf).filter((s): s is KnowledgeSourceView => s !== null);
    return { at: data.at, sources, ...(data.overview !== undefined ? { overview: data.overview as KnowledgeOverview } : {}), ...(data.query !== undefined ? { query: data.query as KnowledgeSnapshot["query"] } : {}), ...(data.hits !== undefined ? { hits: data.hits as KnowledgeSnapshot["hits"] } : {}) };
  } catch {
    return null;
  }
}

export function writeKnowledgeSnapshot(snapshot: KnowledgeSnapshot): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(snapshot));
  } catch {
    // Quota überschritten: die Kopie ist optional, kein Grund zu stören.
  }
}
