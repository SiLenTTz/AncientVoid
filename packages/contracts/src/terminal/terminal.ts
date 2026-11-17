import { z } from "zod";

/** ADR-0087: konfiguriertes Terminal-Ziel (Allowlist). */
export const TerminalTarget = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
  /** OpenSSH-Ziel oder Host-Alias aus ~/.ssh/config des Hub-Hosts. */
  ssh: z.string().min(1).max(200).optional(),
  /** Shell auf dem Hub-Host selbst (`script` + bash). */
  local: z.boolean().optional(),
}).superRefine((v, ctx) => {
  const hasSsh = Boolean(v.ssh);
  const hasLocal = v.local === true;
  if (hasSsh === hasLocal) {
    ctx.addIssue({ code: "custom", message: "Genau eines von ssh | local=true" });
  }
});
export type TerminalTarget = z.infer<typeof TerminalTarget>;

export const TerminalList = z.object({
  terminals: z.array(TerminalTarget),
});
export type TerminalList = z.infer<typeof TerminalList>;

export const TerminalTicket = z.object({
  ticket: z.string().min(1),
  expiresAt: z.number().int().positive(),
});
export type TerminalTicket = z.infer<typeof TerminalTicket>;

/** WebSocket-Frame Client↔Server (ADR-0087). */
export const TerminalFrame = z.discriminatedUnion("t", [
  z.object({ t: z.literal("i"), d: z.string() }),
  z.object({ t: z.literal("o"), d: z.string() }),
  z.object({ t: z.literal("r"), cols: z.number().int().positive(), rows: z.number().int().positive() }),
  z.object({ t: z.literal("x"), code: z.number().int() }),
  z.object({ t: z.literal("e"), m: z.string() }),
]);
export type TerminalFrame = z.infer<typeof TerminalFrame>;

export const TERMINAL_TICKET_TTL_MS = 60_000;
export const TERMINAL_MAX_PENDING_TICKETS = 16;
export const TERMINAL_MAX_ACTIVE = 4;
