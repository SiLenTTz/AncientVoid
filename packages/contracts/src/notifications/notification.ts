/** ADR-0015: what the hub tells the user about, across sessions. */
export type NotificationLevel = "info" | "success" | "warning" | "error";

export interface HubNotification {
  id: number;
  sessionId: string;
  level: NotificationLevel;
  title: string;
  detail: string | null;
  /** The event kind that caused it, e.g. "provider.error". */
  kind: string;
  createdAt: string;
}
