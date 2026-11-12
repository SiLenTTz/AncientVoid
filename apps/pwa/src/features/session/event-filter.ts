import { type NormalizedEvent } from "../../shared/ws.ts";

/**
 * T1.6 filter engine — three presets per EPIC-P1 §2/§5 (AC-P1-4), not the
 * four ad-hoc ones P0 shipped ("Alle"/"Lesen"/"Tool-Calls"/"Denken").
 * "Überwachen" is the default: hides large
 * tool_result payloads (AC-P1-4's ">2KB" — measured from EventStore's own
 * K5 byte count when the event was blob-offloaded, else a JSON-size
 * estimate, since the wire event doesn't carry an explicit byte count
 * otherwise).
 */
export type FilterPreset = "ueberwachen" | "debuggen" | "lesen";

export const LARGE_TOOL_RESULT_BYTES = 2048;

export function payloadByteEstimate(e: NormalizedEvent): number {
  const bytes = (e.payload as { bytes?: unknown }).bytes;
  if (typeof bytes === "number") return bytes;
  try {
    return JSON.stringify(e.payload).length;
  } catch {
    return 0;
  }
}

export function isLargeToolResult(e: NormalizedEvent): boolean {
  return e.type === "tool_result" && payloadByteEstimate(e) > LARGE_TOOL_RESULT_BYTES;
}

/** BUG-0046: a thinking block whose text the provider did not deliver. Older stored events lack the `redacted` flag. */
export function isEmptyThinking(event: NormalizedEvent): boolean {
  if (event.type !== "thinking") return false;
  const text = (event.payload as { text?: unknown }).text;
  return typeof text !== "string" || text.trim() === "";
}

export function showInChat(event: NormalizedEvent): boolean {
  if (isEmptyThinking(event)) return false; // nothing to read — it stays in the Verlauf
  if (event.type === "assistant" || event.type === "user" || event.type === "thinking") return true;
  if (event.type !== "system") return false;
  const payload = event.payload as { kind?: unknown; reason?: unknown; ok?: unknown };
  return (
    payload.kind === "opencode.model" ||
    payload.kind === "opencode.step_start" ||
    payload.kind === "acp.model" ||
    payload.kind === "session.skill_chain" ||
    payload.kind === "provider.error" ||
    payload.kind === "cursor.usage_limit" ||
    payload.kind === "acp.queued" ||
    (payload.kind === "session.steer" && payload.ok === false) ||
    (payload.kind === "opencode.step_finish" && payload.reason === "length")
  );
}

export const FILTERS: { id: FilterPreset; label: string; keep: (e: NormalizedEvent) => boolean }[] = [
  { id: "lesen", label: "Lesen", keep: showInChat },
  {
    id: "ueberwachen",
    label: "Überwachen",
    keep: (e) => !isLargeToolResult(e),
  },
  { id: "debuggen", label: "Debuggen", keep: () => true },
];

/** Filter state is device-local (PRD §6.4, AC-P1-4) — never a server
 * roundtrip, survives reload via localStorage, and is per-device by
 * construction (each browser has its own storage). */
export function loadFilter(): FilterPreset {
  const stored = localStorage.getItem("ancientvoid.filter");
  return stored === "lesen" || stored === "ueberwachen" || stored === "debuggen" ? stored : "ueberwachen";
}

/** T1.8: correlates a tool_use with its tool_result by the id both
 * adapters emit under (`payload.id` on tool_use, `payload.toolUseId` on
 * tool_result — verified consistent across adapter-claude and
 * adapter-codex's normalize.ts). */
export function toolIdOf(e: NormalizedEvent): string | undefined {
  if (e.type === "tool_use") return (e.payload as { id?: unknown }).id as string | undefined;
  if (e.type === "tool_result") return (e.payload as { toolUseId?: unknown }).toolUseId as string | undefined;
  return undefined;
}
