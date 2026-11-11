import type { ApprovalRequest, SessionRecord } from "../../shared/api.ts";
import { displayState, needsYou } from "../../shared/display-state.ts";
import { compareByActivity } from "./session-list.ts";

/**
 * EPIC-P43 T43.3: der Start als Warteschlange. Die Gruppe einer Session folgt ihrem Anzeigezustand
 * (shared/display-state.ts), nicht mehr der Zeit seit der letzten Aktivität:
 *
 *   braucht  „Du bist dran“  Freigabe, Frage, fertiger ungesehener Zug, Fehler, Unterbrechung
 *   aktiv    „Arbeitet“      startet, arbeitet, stoppt
 *   pins     „Angeheftet“    ruhig, aber vom Nutzer nach oben geholt (bleibt offen)
 *   zuletzt  „Ruhig“         alles andere; eingeklappt, solange weiter oben etwas steht
 *
 * Die Schlüssel sind die alten Abschnittsnamen (CSS-Klassen `section-<key>`, Sprachbefehl-Filter).
 */
export type Section = "braucht" | "aktiv" | "pins" | "zuletzt";

export const SECTION_ORDER: readonly Section[] = ["braucht", "aktiv", "pins", "zuletzt"];
export const SECTION_TITLE: Record<Section, string> = { braucht: "Du bist dran", aktiv: "Arbeitet", pins: "Angeheftet", zuletzt: "Ruhig" };

export function sectionOf(s: Pick<SessionRecord, "status" | "pinned">, unseen = false): Section {
  const state = displayState({ status: s.status, unseen });
  if (needsYou(state)) return "braucht";
  if (state === "working") return "aktiv";
  return s.pinned ? "pins" : "zuletzt";
}

/**
 * „Du bist dran“: was abläuft, zuerst (kürzeste Restzeit), danach das, was am längsten wartet.
 * Die anderen Gruppen bleiben bei „zuletzt bewegt zuerst“.
 */
export function compareQueue(deadline: (s: SessionRecord) => string | null): (a: SessionRecord, b: SessionRecord) => number {
  return (a, b) => {
    const da = deadline(a);
    const db = deadline(b);
    if (da !== null || db !== null) {
      if (da === null) return 1;
      if (db === null) return -1;
      if (da !== db) return da < db ? -1 : 1;
    }
    return -compareByActivity(a, b);
  };
}

/**
 * Entscheidbar auf der Karte: genau eine offene Werkzeug-/Hub-Freigabe ohne Begründungspflicht und
 * ohne Passkey. Rückfragen (eigene Antwort nötig), destruktive Freigaben (WebAuthn) und Freigaben mit
 * Begründung behalten ihren Weg über die Session.
 */
export function decidableOnCard(req: ApprovalRequest): boolean {
  return req.status === "pending" && req.class !== "destructive" && !req.reasonRequired && !req.tool?.questions;
}

/** Die offene Anfrage einer Session; bei mehreren die, die zuerst abläuft. */
export function pendingFor(approvals: readonly ApprovalRequest[], sessionId: string): ApprovalRequest | null {
  const mine = approvals.filter((a) => a.sessionId === sessionId && a.status === "pending");
  if (mine.length === 0) return null;
  return mine.reduce((first, a) => (a.timeoutAt < first.timeoutAt ? a : first));
}

/** „Ruhig“ ist zu, solange weiter oben etwas steht — es sei denn, der Nutzer hat es anders gewählt oder sucht. */
export function quietOpen(choice: boolean | null, counts: Record<Section, number>, searching: boolean): boolean {
  if (searching) return true;
  if (choice !== null) return choice;
  return counts.braucht + counts.aktiv + counts.pins === 0;
}
