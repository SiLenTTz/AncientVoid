import { type GateWaitStatistics, type NormalizedEvent } from "@ancientvoid/contracts";
import { statisticsDistribution } from "./distribution.ts";

/** P56 T56.1b: ein zusammengehöriges Gate-Intervall (Kopplung über die approvalId bzw. gate id). */
export interface GateWaitInterval {
  gateId: string;
  toolName: string | null;
  waitMs: number | null;
  status: "answered" | "timed_out" | "open" | "auto_approved";
}

const kindOf = (e: NormalizedEvent): unknown => (e.payload as { kind?: unknown }).kind;

/**
 * Tool-Gates aus dem Journal: `tool.permission_requested` öffnet das
 * Intervall, `tool.permission_answered` schließt es (auch abgelaufene).
 * `tool.auto_approved` wartet nie und liefert kein Warteintervall.
 * Ein Antworten ohne passendes Öffnen ist ein Korrelationsbruch und wird
 * abgelehnt, statt still zu verschwinden (Fail loud).
 */
export function deriveGateWaitIntervals(events: readonly NormalizedEvent[]): GateWaitInterval[] {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  const open = new Map<string, { toolName: string | null; requestedAt: number }>();
  const intervals: GateWaitInterval[] = [];
  for (const e of sorted) {
    if (e.type !== "gate") continue;
    const kind = kindOf(e);
    const { approvalId, toolName } = e.payload as { approvalId?: unknown; toolName?: unknown };
    const id = typeof approvalId === "string" ? approvalId : null;
    const name = typeof toolName === "string" ? toolName : null;
    const ts = Date.parse(e.ts);
    if (kind === "tool.permission_requested") {
      if (id === null) throw new Error("Gate-Öffnen ohne approvalId.");
      if (open.has(id)) throw new Error("Doppeltes Gate-Öffnen für dieselbe approvalId.");
      open.set(id, { toolName: name, requestedAt: ts });
      continue;
    }
    if (kind === "tool.permission_answered") {
      if (id === null) throw new Error("Gate-Antworten ohne approvalId.");
      const request = open.get(id);
      if (!request) throw new Error("Gate-Antworten ohne zusammengehöriges Öffnen.");
      open.delete(id);
      intervals.push({
        gateId: id,
        toolName: request.toolName,
        waitMs: Number.isFinite(request.requestedAt) && Number.isFinite(ts) ? Math.max(0, ts - request.requestedAt) : null,
        status: (e.payload as { status?: unknown }).status === "timed_out" ? "timed_out" : "answered",
      });
      continue;
    }
    if (kind === "tool.auto_approved") {
      intervals.push({ gateId: `auto:${e.seq}`, toolName: name, waitMs: null, status: "auto_approved" });
    }
  }
  for (const [id, request] of open) {
    intervals.push({ gateId: id, toolName: request.toolName, waitMs: null, status: "open" });
  }
  return intervals.sort((a, b) => a.gateId < b.gateId ? -1 : a.gateId > b.gateId ? 1 : 0);
}

/** Verteilung nur über belegte Intervalle; offene/automatische Gates zählen getrennt. */
export function aggregateGateWaitStatistics(intervals: readonly GateWaitInterval[]): GateWaitStatistics {
  if (intervals.length === 0) throw new Error("Keine Gates für Statistik.");
  const byStatus = (status: GateWaitInterval["status"]) => intervals.filter(i => i.status === status).length;
  return {
    gates: intervals.length,
    answered: byStatus("answered"),
    timedOut: byStatus("timed_out"),
    open: byStatus("open"),
    autoApproved: byStatus("auto_approved"),
    waitMs: statisticsDistribution(intervals.filter(i => i.status === "answered" || i.status === "timed_out").map(i => i.waitMs)),
  };
}
