import type { AutomationInfo } from "@ancientvoid/contracts";

export const STATE_LABEL: Record<string, string> = {
  unknown: "Start unklar",
  claimed: "beansprucht",
  dispatched: "gestartet",
  settled: "abgerechnet",
  skipped: "übersprungen",
};

export const REASON_LABEL: Record<string, string> = {
  dst_invalid: "DST-Lücke",
  missed: "verpasst",
  overlap: "Überschneidung",
  lease: "Lease belegt",
  precheck: "Precheck",
  precheck_exit: "Precheck Exit ≠ 0",
  precheck_timeout: "Precheck-Timeout",
  auth: "keine Befugnis",
  quota: "Kontingent",
  host_down: "Host nicht verfügbar",
  disabled: "deaktiviert",
  changed: "Freigabe geändert",
};

export function outcomeLabel(outcome: string): string {
  if (outcome === "succeeded") return "erfolgt";
  if (outcome === "cancelled") return "abgebrochen";
  if (outcome === "failed") return "fehlgeschlagen";
  return outcome === "timeout" ? "Zeitüberschreitung" : outcome;
}

export function scheduleText(info: AutomationInfo): string {
  const s = info.definition.schedule;
  if (s.kind === "preset") {
    const days = s.weekdays && s.weekdays.length > 0 ? ` Mo-So-Filter ${s.weekdays.join(",")}` : "";
    return `${s.preset}${s.localTime ? ` ${s.localTime}` : ""} (${s.timezone})${days}`;
  }
  return `${s.cron} (${s.timezone})`;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

