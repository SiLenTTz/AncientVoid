import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { api } from "./api.ts";

/**
 * EPIC-P41 T41.5 (ADR-0064): hubctl-Zugriff auf Automationen — Liste/Editor/
 * Run-now/Disable/Verlauf. Der CLI rechnet keine Ergebnisse aus; `dispatched`
 * ist ein Startauftrag, das Ergebnis zeigt der Verlauf der referenzierten
 * Ausführung.
 */

/** Eine Verlaufszeile (Claim-Journal) — Struktur wie hub GET /:id/history. */
export interface AutomationHistoryEntry {
  claimKey: string;
  occurrenceUtc: string;
  at: string;
  state: "claimed" | "dispatched" | "settled" | "skipped";
  reason?: string;
  outcome?: string;
  runId?: string;
  sessionId?: string;
}

export interface AutomationInfo {
  definition: {
    id: string;
    label: string;
    generation: number;
    enabled: boolean;
    hostId: string;
    schedule: { kind: string; timezone: string; cron?: string; preset?: string; localTime?: string };
    target: { kind: string; harness?: string; project?: string; templateId?: string; workdir?: string };
    precheckActionId?: string;
    grant: { maxParallel: number; missedGraceMs: number };
    createdAtUtc: string;
  };
  nextOccurrences: { utc: string; local: string }[];
  lastOccurrence: { utc: string; state: string; reason?: string; outcome?: string; runId?: string; sessionId?: string } | null;
}

/**
 * Baut die Definition für POST /api/automations: JSON darf minimal sein —
 * id/generation/enabled/createdAtUtc ergänzt der CLI. Bei einem Session-Ziel
 * wird der Prompt-Blob-Verweis aus dem Prompt-Text berechnet (K5: nur der
 * SHA in der Definition, der Text als Blob beim Hub).
 */
export function buildAutomationDefinition(jsonText: string, promptText: string | null): Record<string, unknown> {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(jsonText) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`Definitions-JSON ist ungültig: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
  const target = raw.target as { kind?: string; promptBlobSha256?: string } | undefined;
  if (!target || (target.kind !== "session" && target.kind !== "run")) {
    throw new Error('Definitions-JSON braucht ein target mit kind "session" oder "run".');
  }
  if (target.kind === "session" && !target.promptBlobSha256) {
    if (promptText === null) throw new Error("Session-Ziel braucht einen Prompt-Text (zweite Datei), sonst fehlt der Blob-Verweis.");
    target.promptBlobSha256 = createHash("sha256").update(promptText).digest("hex");
  }
  return {
    enabled: false, // Neuanfang-Zustand: die Aktivierung ist die separate menschliche Freigabe.
    generation: 1,
    ...raw,
    id: typeof raw.id === "string" && raw.id.length > 0 ? raw.id : randomUUID(),
    createdAtUtc: typeof raw.createdAtUtc === "string" && raw.createdAtUtc.length >= 20 ? raw.createdAtUtc : new Date().toISOString(),
    target,
  };
}

/** Zeile für `automations list` — Label, Zustand, Plan, nächster Termin, letztes Ergebnis. */
export function formatAutomationLine(info: AutomationInfo): string {
  const d = info.definition;
  const plan = d.schedule.kind === "cron" ? `${d.schedule.cron ?? "?"}` : `${d.schedule.preset ?? "?"}${d.schedule.localTime ? ` ${d.schedule.localTime}` : ""}`;
  const next = info.nextOccurrences[0]?.utc ?? "—";
  const last = info.lastOccurrence ? `${info.lastOccurrence.state}${info.lastOccurrence.reason ? `/${info.lastOccurrence.reason}` : ""}` : "—";
  return `${d.id.slice(0, 8)}  ${d.enabled ? "an " : "aus"}  ${d.label.padEnd(24).slice(0, 24)}  ${plan.padEnd(18).slice(0, 18)}  ${d.schedule.timezone.padEnd(14).slice(0, 14)}  next ${next}  last ${last}`;
}

export async function runAutomationsCommand(args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  const readStdinJson = (): string => readFileSync(0, "utf8");
  switch (sub) {
    case "list": {
      const { automations } = await api<{ automations: AutomationInfo[] }>("/api/automations");
      if (automations.length === 0) console.log("(keine Automationen)");
      for (const info of automations) console.log(formatAutomationLine(info));
      break;
    }
    case "show": {
      const id = rest[0];
      if (!id) throw new Error("show braucht eine ID.");
      const { automations } = await api<{ automations: AutomationInfo[] }>("/api/automations");
      const info = automations.find((a) => a.definition.id === id || a.definition.id.startsWith(id));
      if (!info) throw new Error(`unbekannte Automation: ${id}`);
      console.log(JSON.stringify(info.definition, null, 2));
      const { history } = await api<{ history: AutomationHistoryEntry[] }>(`/api/automations/${encodeURIComponent(info.definition.id)}/history`);
      if (history.length === 0) {
        console.log("(kein Verlauf)");
        break;
      }
      for (const h of history) {
        console.log(`${h.at}  ${h.occurrenceUtc}  ${h.state}${h.reason ? `/${h.reason}` : ""}${h.outcome ? ` ${h.outcome}` : ""}${h.sessionId ? `  session ${h.sessionId}` : ""}${h.runId ? `  run ${h.runId}` : ""}`);
      }
      break;
    }
    case "enable":
    case "disable": {
      const id = rest[0];
      if (!id) throw new Error(`${sub} braucht eine ID.`);
      const stored = await api<{ id: string; enabled: boolean }>(`/api/automations/${encodeURIComponent(id)}/enable`, {
        method: "POST",
        body: JSON.stringify({ enabled: sub === "enable" }),
      });
      console.log(`${stored.id} ${stored.enabled ? "aktiviert" : "deaktiviert"}`);
      break;
    }
    case "run-now": {
      const id = rest[0];
      if (!id) throw new Error("run-now braucht eine ID.");
      const claim = await api<AutomationHistoryEntry>(`/api/automations/${encodeURIComponent(id)}/run-now`, { method: "POST" });
      console.log(`${claim.claimKey}  ${claim.state}${claim.reason ? ` (${claim.reason})` : ""}${claim.sessionId ? `  session ${claim.sessionId}` : ""}`);
      break;
    }
    case "create": {
      const [definitionPath, promptPath] = rest;
      if (!definitionPath) throw new Error("create braucht eine Definitions-JSON-Datei (und bei Session-Zielen eine Prompt-Datei).");
      const jsonText = definitionPath === "-" ? readStdinJson() : readFileSync(definitionPath, "utf8");
      const promptText = promptPath ? readFileSync(promptPath, "utf8") : null;
      const definition = buildAutomationDefinition(jsonText, promptText);
      const stored = await api<{ id: string; enabled: boolean; generation: number }>("/api/automations", {
        method: "POST",
        body: JSON.stringify({ definition, ...(promptText === null ? {} : { promptText }) }),
      });
      console.log(`${stored.id}  generation ${stored.generation}  ${stored.enabled ? "aktiv" : "aus"} (Aktivierung separat: hubctl automations enable <id>)`);
      break;
    }
    default:
      throw new Error(`unbekannter automations-Befehl: ${sub ?? "(fehlt)"} — list | show | enable | disable | run-now | create`);
  }
}
