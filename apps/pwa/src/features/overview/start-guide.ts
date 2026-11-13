/**
 * EPIC-P57 T57.9: wann zeigt die Übersicht den Einstieg statt eines Leerzustands? Nur auf einem Hub ohne jede
 * Session (auch ohne archivierte) und ohne aktiven Filter — Filter-, Such- und Archiv-Leerzustände bleiben, wie sie waren.
 */
export interface StartGuideInput {
  /** Alle Sessions dieses Hubs, vor jedem Filter, inklusive archivierter. */
  total: number;
  /** Sichtbare Sessions nach Filtern. */
  visible: number;
  query: string;
  hostFiltered: boolean;
  showArchived: boolean;
  statusFilter: string;
}

export function showStartGuide(i: StartGuideInput): boolean {
  return i.total === 0 && i.visible === 0 && i.query.trim() === "" && !i.hostFiltered && !i.showArchived && (i.statusFilter === "all" || i.statusFilter === "recent");
}

/** Text des bisherigen Leerzustands, wenn der Einstieg nicht gilt. */
export function emptyText(i: Pick<StartGuideInput, "query" | "hostFiltered" | "showArchived">): string {
  return i.query || i.hostFiltered ? "nichts gefunden" : i.showArchived ? "nichts archiviert" : "keine Sessions — lege eine an";
}
