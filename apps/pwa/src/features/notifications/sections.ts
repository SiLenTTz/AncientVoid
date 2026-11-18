/**
 * Nutzerwunsch 2026-11-18: Die Abschnitte des Benachrichtigungs-Panels sind
 * einklappbar; Vorgabe ist, dass nur Abschnitte mit noch ungesehenen
 * Meldungen offen stehen (Read-Mark je Host wie der Glocken-Zähler). Die
 * Ableitung ist rein — keine Komponenten-Importe, testbar und vom Renderbaum
 * entkoppelt (Muster: urgency.ts, EPIC-P64 T64.1).
 */
import { APPROVAL_KINDS } from "./urgency.ts";

export type SectionKey = "errors" | "questions" | "rest";

/** Abschnitts-Reihenfolge wie das Panel: Fehler, offene Fragen, Rest. */
export const SECTION_KEYS: readonly SectionKey[] = ["errors", "questions", "rest"];

export interface SectionItem {
  /** Notification-Id je Host — Read-Mark-Vergleich. */
  id: number;
  /** null = eigener Hub; Peer-Hosts haben eigene Read-Marks. */
  hostId: string | null;
  /** Session der Freigabe (für die Pending-Menge), sonst beliebig. */
  sessionId: string | null;
  level: string;
  kind: string;
}

/** Einteilung einer Meldung: Fehler-Level zuerst, dann live offene Fragen
 * (gleiche Prüfung wie bisher der angepinnte Fragen-Abschnitt), dann der Rest. */
export function sectionOf(n: SectionItem, pending: ReadonlySet<string>): SectionKey {
  if (n.level === "error") return "errors";
  if (APPROVAL_KINDS.has(n.kind) && pending.has(`${n.hostId ?? ""}#${n.sessionId}`)) return "questions";
  return "rest";
}

/** Noch ungesehene Meldungen je Abschnitt — Grundlage der Einklapp-Vorgabe
 * (Abschnitt offen ⇔ Zahl > 0). */
export function unseenBySection(
  items: readonly SectionItem[],
  read: Record<string, number>,
  pending: ReadonlySet<string>,
): Record<SectionKey, number> {
  const out: Record<SectionKey, number> = { errors: 0, questions: 0, rest: 0 };
  for (const n of items) {
    if (n.id > (read[n.hostId ?? ""] ?? 0)) out[sectionOf(n, pending)] += 1;
  }
  return out;
}

/** Einklapp-Vorgabe je Abschnitt: offen ⇔ ungesehene Meldungen ODER (nur beim
 * Fragen-Abschnitt) eine noch live offene Freigabe. Ein Read-Mark löscht eine
 * offene Frage nicht — genauso wie beim Glocken-Glow (urgency.ts) — denn eine
 * unbeantwortete Frage ist nie „erledigt angesehen". */
export function defaultExpanded(
  items: readonly SectionItem[],
  read: Record<string, number>,
  pending: ReadonlySet<string>,
): Record<SectionKey, boolean> {
  const unseen = unseenBySection(items, read, pending);
  const openQuestion = items.some((n) => sectionOf(n, pending) === "questions");
  return { errors: unseen.errors > 0, questions: unseen.questions > 0 || openQuestion, rest: unseen.rest > 0 };
}
