import { z } from "zod";

/** EPIC-P19 / ADR-0038: ein Loop (Dark Factory) ist eine zusätzliche Auswahldimension beim Sessionstart. */
export const LoopId = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);
export type LoopId = z.infer<typeof LoopId>;

/** Was der Client beim Start mitschickt. Optionen sind providereigen (z. B. Orchestrator `self | hermes`). */
export const LoopSpec = z.object({
  id: LoopId,
  options: z.record(z.string().max(60), z.string().max(200)).optional(),
});
export type LoopSpec = z.infer<typeof LoopSpec>;

/** Eine Auswahl, die ein Loop anbietet (Fähigkeiten-getrieben, nie im Client festverdrahtet). */
export interface LoopOptionInfo {
  key: string;
  label: string;
  values: { value: string; label: string }[];
  default: string;
}

/** `GET /api/loops` — ohne Secrets. `available: false` heißt: sichtbar, aber nicht startbar, mit Grund. */
export interface LoopInfo {
  id: LoopId;
  label: string;
  description: string;
  /** Transport zum Loop-System, nur zur Anzeige. */
  transport: "mqtt" | "cli";
  available: boolean;
  /** Pflicht, wenn `available` false ist — fail loud statt stiller Lücke. */
  reason?: string;
  options: LoopOptionInfo[];
}
