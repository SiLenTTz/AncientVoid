/** T8.1: session status in words a person uses. The raw value stays in
 * `data-status` and the CSS class. */
const LABEL: Record<string, string> = {
  starting: "startet",
  working: "arbeitet",
  idle: "bereit",
  waiting_approval: "Freigabe nötig",
  parked: "pausiert",
  stopped: "beendet",
  error: "Fehler",
  interrupted: "unterbrochen",
};

export function statusLabel(status: string): string {
  return LABEL[status] ?? status;
}

/** "vor 3 min" — short enough for a card. */
export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "gerade eben";
  if (s < 3600) return `vor ${Math.round(s / 60)} min`;
  if (s < 86_400) return `vor ${Math.round(s / 3600)} h`;
  return `vor ${Math.round(s / 86_400)} d`;
}
