import type { DiscoveredSession } from "../../shared/api.ts";

/**
 * BUG-0035-Nachfolge: sessions grouped by project, collapsible in the UI —
 * the group of the MOST RECENTLY observed session leads and is the one
 * expanded by default; everything else starts folded. Pure, so the
 * ordering rule is testable without a browser.
 *
 * EPIC-P34 T34.7: Rauschen (`temporary`: /tmp, Fabrik-Kopien) steht gesammelt in einer Gruppe am Ende —
 * eingeklappt, nie gelöscht, die Suche findet es weiter. Subagenten hängen an ihrer Hauptsession,
 * solange diese in derselben Gruppe steht.
 */
export const TEMPORARY_GROUP = "Temporär & Automatisch";

export interface ProjectGroup {
  project: string;
  /** Karten der obersten Ebene (Subagenten, deren Hauptsession da ist, stehen in `subagents`). */
  sessions: DiscoveredSession[];
  /** Subagenten je nativer ID ihrer Hauptsession. */
  subagents: Record<string, DiscoveredSession[]>;
  /** Alles Gefundene der Gruppe, Subagenten eingerechnet. */
  total: number;
  newestAt: string;
  temporary: boolean;
}

function projectName(project: string): string {
  return project.split("/").filter(Boolean).pop() ?? project;
}

const newestFirst = (a: DiscoveredSession, b: DiscoveredSession) => b.observedAt.localeCompare(a.observedAt);

export function groupDiscovery(items: readonly DiscoveredSession[]): ProjectGroup[] {
  const map = new Map<string, { project: string; all: DiscoveredSession[]; newestAt: string; temporary: boolean }>();
  for (const item of items) {
    const temporary = item.temporary === true;
    const key = temporary ? TEMPORARY_GROUP : projectName(item.project);
    const group = map.get(key) ?? { project: key, all: [], newestAt: item.observedAt, temporary };
    group.all.push(item);
    if (item.observedAt > group.newestAt) group.newestAt = item.observedAt;
    map.set(key, group);
  }
  return [...map.values()]
    .sort((a, b) => Number(a.temporary) - Number(b.temporary) || b.newestAt.localeCompare(a.newestAt))
    .map((g) => {
      const present = new Set(g.all.map((s) => s.nativeSessionId).filter((id): id is string => id !== null));
      const subagents: Record<string, DiscoveredSession[]> = {};
      const top: DiscoveredSession[] = [];
      for (const s of [...g.all].sort(newestFirst)) {
        if (s.parentSessionId && present.has(s.parentSessionId)) (subagents[s.parentSessionId] ??= []).push(s);
        else top.push(s);
      }
      return { project: g.project, sessions: top, subagents, total: g.all.length, newestAt: g.newestAt, temporary: g.temporary };
    });
}
