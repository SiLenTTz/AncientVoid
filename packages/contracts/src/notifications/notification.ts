/** ADR-0015: what the hub tells the user about, across sessions. */
export type NotificationLevel = "info" | "success" | "warning" | "error";

/**
 * EPIC-P67 / ADR-0088 T67.6: Aktion einer Benachrichtigung — ein Knopf, der
 * genau diesen Hub-Endpunkt ruft (gleicher Endpunkt wie das Session-Menü).
 * Rein additiv: Bestand ohne `action` rendert wie bisher.
 */
export interface NotificationAction {
  label: string;
  method: "POST";
  /** Hub-API-Pfad inklusive Session-Id, z. B. `/api/sessions/<id>/main-sync`. */
  path: string;
}

export interface HubNotification {
  id: number;
  sessionId: string;
  level: NotificationLevel;
  title: string;
  detail: string | null;
  /** The event kind that caused it, e.g. "provider.error". */
  kind: string;
  createdAt: string;
  /** EPIC-P67: optionaler Aktionsknopf — null/undefined = keine Aktion. */
  action?: NotificationAction | null;
}
