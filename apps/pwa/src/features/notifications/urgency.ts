/**
 * EPIC-P64 T64.1: Dringlichkeit der Benachrichtigungs-Glocke als reine
 * Funktion — Grundlage für den Glow (rot Fehler, gelb offene Frage,
 * grün Lauf beendet). Absichtlich ohne Komponenten-Importe: testbar und
 * vom Renderbaum entkoppelt.
 *
 * Ungelesen = Eintrag oberhalb des Read-Marks seines Hosts (Panel-Öffnen
 * setzt es, wie heute). Offene Fragen sind härter: Sie glühen, solange die
 * zugehörige Freigabe live pending ist (gleiche Prüfung wie der angepinnte
 * Panel-Abschnitt) — ein Read-Mark löscht eine noch offene Frage nicht.
 */

/** Kinds, die eine Freigabe/Frage anzeigen (Single Source, auch für Notifications.tsx). */
export const APPROVAL_KINDS = new Set(["tool.permission_requested", "session.steer_pending_approval"]);

/** EPIC-P67 T67.6: Kinds des Main-Sync, die eine Entscheidung wollen —
 * Rückfrage (ask-Modus, Aktionsknopf) und Konflikt glühen wie offene Fragen. */
export const MAIN_SYNC_ACTION_KINDS = new Set(["mainsync.behind_ask", "mainsync.conflict"]);

export type Urgency = "error" | "action" | "done";

export interface UrgencyItem {
  /** Notification-Id je Host — Read-Mark-Vergleich. */
  id: number;
  /** null = eigener Hub; Peer-Hosts haben eigene Read-Marks. */
  hostId: string | null;
  /** Session der Freigabe (für die Pending-Menge), sonst beliebig. */
  sessionId: string | null;
  level: string;
  kind: string;
}

/** T64.3: gibt es überhaupt Freigabe-/Fragen-Kandidaten im Bestand? Nur dann
 * lohnt der Hintergrund-Refresh der Pending-Menge (ein API-Ruf je 4 s). */
export function hasApprovalCandidates(items: readonly { kind: string }[]): boolean {
  return items.some((n) => APPROVAL_KINDS.has(n.kind));
}

const RANK: Record<Urgency, number> = { error: 0, action: 1, done: 2 };

/** Höchste offene Dringlichkeit; null = kein Glow. */
export function urgencyOf(items: readonly UrgencyItem[], read: Record<string, number>, pending: ReadonlySet<string>): Urgency | null {
  let worst: Urgency | null = null;
  for (const n of items) {
    const host = n.hostId ?? "";
    const unread = n.id > (read[host] ?? 0);
    let u: Urgency | null = null;
    if (n.level === "error" && unread) u = "error";
    else if (APPROVAL_KINDS.has(n.kind) && n.sessionId !== null && pending.has(`${host}#${n.sessionId}`)) u = "action";
    else if (MAIN_SYNC_ACTION_KINDS.has(n.kind) && unread) u = "action";
    else if (n.kind === "session.turn_end" && unread) u = "done";
    if (u !== null && (worst === null || RANK[u] < RANK[worst])) worst = u;
  }
  return worst;
}
