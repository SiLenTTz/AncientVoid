import { z } from "zod";

export const EXTERNAL_ACTIVITY_TTL_MS = 90_000;
export const ACTIVITY_HEARTBEAT_MS = 20_000;
export type QueueDeliveryState = "unknown";

/** ADR-0076 (BUG-0155 T2): strukturierter Aktivitätsbericht eines Adapters
 * oder registrierten Jobs — nie aus Assistant-Text geschlossen. Das Register
 * selbst (Storage-Typ `SessionActivity`, ADR-0074) lebt im Hub. */
export const ActivityReport = z.object({
  id: z.string().min(1).max(200),
  kind: z.enum(["tool", "agent", "job"]),
  state: z.enum(["running", "completed", "failed"]),
  label: z.string().max(160).optional(),
});
export type ActivityReport = z.infer<typeof ActivityReport>;
