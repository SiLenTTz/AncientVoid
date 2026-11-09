import { z } from "zod";
import type { LoopCapabilities } from "./connector.ts";

/** EPIC-P19 / ADR-0038: ein Loop (Dark Factory) ist eine zusätzliche Auswahldimension beim Sessionstart. */
export const LoopId = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);
export type LoopId = z.infer<typeof LoopId>;

/** Was der Client beim Start mitschickt. Betriebsart und Orchestrator sind providereigene Namen. */
export const LoopSpec = z.object({
  id: LoopId,
  /** „Betriebsart“ des Loops (aSPARK: manual|supervised|autonomous|dark, securesight-factory: a|b). */
  mode: z.string().min(1).max(40).optional(),
  orchestrator: z.string().min(1).max(40).optional(),
  /** Weitere Felder aus `capabilities.options`; Werte sind Text (Schalter: "true"/"false"). */
  options: z.record(z.string().max(60), z.string().max(500)).optional(),
});
export type LoopSpec = z.infer<typeof LoopSpec>;

/** Wie der Hub den Loop-Eintrag der Session in `args.loop` ablegt (ein Ort, kein zweites Schema). */
export const LOOP_ARG = "loop";

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
  /** Aus dem Connector; null, solange keiner angebunden ist. */
  capabilities: LoopCapabilities | null;
}

/** Id des internen Adapters, der einen Loop als Session abbildet (`loopAsAdapter`). */
export const LOOP_ADAPTER_PREFIX = "loop:";
export const loopAdapterId = (loopId: string): string => `${LOOP_ADAPTER_PREFIX}${loopId}`;
export const isLoopAdapter = (adapterId: string): boolean => adapterId.startsWith(LOOP_ADAPTER_PREFIX);
export const loopIdOf = (adapterId: string): string => adapterId.slice(LOOP_ADAPTER_PREFIX.length);
