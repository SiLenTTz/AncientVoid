import type { WorkspaceServiceLogs, WorkspaceStatus } from "@ancientvoid/contracts";
import { api } from "./cli.ts";

/**
 * EPIC-P29 T29.6: `hubctl workspace …` — Status, Logs, menschlicher Retry
 * und die fertige Preview-URL (Ticket eingebettet) für eine Session.
 */

const PHASE: Record<string, string> = {
  preparing: "bereitet vor",
  ready: "bereit",
  failed: "fehlgeschlagen",
  needs_attention: "klärungsbedürftig",
  approval_required: "Freigabe nötig",
};

/** Rein, für Tests: der Status als Zeilen (Basis-/Manifest-Hash gekürzt). */
export function formatWorkspaceStatus(status: WorkspaceStatus): string[] {
  const lines = [
    `phase: ${PHASE[status.phase] ?? status.phase}  (Basis ${status.baseSha.slice(0, 8)} · Manifest ${status.manifestHash.slice(0, 8)})`,
  ];
  if (status.failure) {
    const failure = status.failure;
    lines.push(
      `fehler: ${failure.kind}${typeof failure.exitCode === "number" ? ` (Exit ${failure.exitCode})` : ""} in „${failure.step}“${failure.detail ? ` — ${failure.detail}` : ""}${failure.logBlobRef ? ` · Log ${failure.logBlobRef}` : ""}`,
    );
  }
  if (status.services.length === 0) lines.push("services: keine");
  for (const service of status.services) {
    lines.push(`service ${service.id}: ${service.state}${service.port !== null ? ` port=${service.port}` : ""} (Stand ${service.updatedAt})`);
    if (service.failure) lines.push(`  fehler: ${service.failure.kind} in „${service.failure.step}“${service.failure.detail ? ` — ${service.failure.detail}` : ""}`);
  }
  return lines;
}

function usage(): never {
  console.log(`hubctl workspace — EPIC-P29 (ADR-0051)

Usage:
  hubctl workspace <sessionId>                     Phase, Basis-SHA, Manifest-Hash, Services
  hubctl workspace logs <sessionId> <serviceId>    gekappter Log-Schwanz (K5)
  hubctl workspace retry <sessionId>               menschlicher Retry nach Fehler/klärungsbedürftig
  hubctl workspace preview <sessionId> <serviceId> fertige Preview-URL (Ticket gültig 5 min)`);
  process.exit(1);
}

export async function runWorkspace(args: string[]): Promise<void> {
  const [sub, sessionId, serviceId] = args;
  if (!sessionId) usage();
  if (sub === "logs") {
    if (!serviceId) usage();
    const logs = await api<WorkspaceServiceLogs>(`/api/sessions/${sessionId}/workspace/services/${encodeURIComponent(serviceId)}/logs`);
    console.log(logs.tail === "" ? "(noch keine Ausgabe)" : logs.tail);
    if (logs.truncated) console.log("… (gekürzt, volle Logs liegen im Hub unter data/services/)");
    return;
  }
  if (sub === "retry") {
    const ack = await api<{ ok: boolean; detail?: string }>(`/api/sessions/${sessionId}/workspace/retry`, { method: "POST", body: "{}" });
    console.log(ack.ok ? `ok: ${ack.detail ?? ""}`.trim() : `abgelehnt: ${ack.detail ?? ""}`);
    if (!ack.ok) process.exitCode = 1;
    return;
  }
  if (sub === "preview") {
    if (!serviceId) usage();
    const ticket = await api<{ ticket: string; expiresAt: number }>(`/api/sessions/${sessionId}/workspace/services/${encodeURIComponent(serviceId)}/preview-ticket`, { method: "POST", body: "{}" });
    const base = process.env.ANCIENTVOID_URL ?? "http://127.0.0.1:7373";
    console.log(`${base}/api/sessions/${sessionId}/workspace/services/${encodeURIComponent(serviceId)}/proxy/?ticket=${encodeURIComponent(ticket.ticket)}`);
    console.log(`gültig bis ${new Date(ticket.expiresAt).toISOString()} — nur für diesen einen Service`);
    return;
  }
  // kein Sub-Kommando: Status (sessionId steht dann in sub)
  const status = await api<WorkspaceStatus>(`/api/sessions/${sub}/workspace`);
  for (const line of formatWorkspaceStatus(status)) console.log(line);
}
