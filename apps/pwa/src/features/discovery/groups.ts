import type { DiscoveredSession } from "../../shared/api.ts";

/**
 * BUG-0035-Nachfolge: sessions grouped by project, collapsible in the UI —
 * the group of the MOST RECENTLY observed session leads and is the one
 * expanded by default; everything else starts folded. Pure, so the
 * ordering rule is testable without a browser.
 */
export interface ProjectGroup {
  project: string;
  sessions: DiscoveredSession[];
  newestAt: string;
}

function projectName(project: string): string {
  return project.split("/").filter(Boolean).pop() ?? project;
}

export function groupDiscovery(items: readonly DiscoveredSession[]): ProjectGroup[] {
  const map = new Map<string, { project: string; sessions: DiscoveredSession[]; newestAt: string }>();
  for (const item of items) {
    const key = projectName(item.project);
    const group = map.get(key) ?? { project: key, sessions: [], newestAt: item.observedAt };
    group.sessions.push(item);
    if (item.observedAt > group.newestAt) group.newestAt = item.observedAt;
    map.set(key, group);
  }
  return [...map.values()]
    .sort((a, b) => b.newestAt.localeCompare(a.newestAt))
    .map((g) => ({ ...g, sessions: [...g.sessions].sort((a, b) => b.observedAt.localeCompare(a.observedAt)) }));
}
