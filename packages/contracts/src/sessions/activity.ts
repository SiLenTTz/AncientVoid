import { z } from "zod";

export const EXTERNAL_ACTIVITY_TTL_MS = 90_000;
export const ACTIVITY_HEARTBEAT_MS = 20_000;
export type QueueDeliveryState = "unknown";

/** ADR-0074: structured work, never inferred from assistant prose. */
export const SessionActivity = z.object({
  id: z.string().min(1).max(200),
  kind: z.enum(["tool", "agent", "job"]),
  state: z.enum(["running", "completed", "failed"]),
  label: z.string().max(160).optional(),
});
export type SessionActivity = z.infer<typeof SessionActivity>;
