/**
 * EPIC-P65 T65.2: Kategorie-Mapping für Status-Sounds — reine Funktion,
 * gleiche Taxonomie wie der P64-Glow (urgency.ts). `pending` ist die live
 * bestätigte Freigabe-Warteschlangen-Prüfung (gleicher Kanal wie der Toast).
 */
import { APPROVAL_KINDS } from "./urgency.ts";
import type { SoundCategory } from "../../shared/audio.ts";

export function soundCategoryOf(n: { level: string; kind: string; pending: boolean }): SoundCategory | null {
  if (n.level === "error") return "error";
  if (n.kind === "session.turn_end") return "done";
  if (APPROVAL_KINDS.has(n.kind)) return n.pending ? "action" : "info";
  if (n.level === "info" || n.level === "success" || n.level === "warning") return "info";
  return null;
}
