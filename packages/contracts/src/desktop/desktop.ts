import { z } from "zod";

/**
 * EPIC-P11 (ADR-0031): the desktop companion. A small process on a PC
 * types what a person dictated into the window that has the focus — only
 * after the person saw that window as the target, only while it still has
 * the focus, never into password fields, never twice.
 */
export const COMPANION_TOKEN_PREFIX = "companion:";

/** The companion's own routes — the only ones its token reaches. */
export function companionTokenAllows(path: string): boolean {
  return path.startsWith("/api/desktop/companion/");
}

export interface DesktopFocus {
  /** Window id of the compositor (Hyprland address, sway con id). */
  id: string;
  app: string;
  title: string;
  /** Counts every focus change; a plan made at revision n is void at n+1. */
  revision: number;
}

export interface CompanionState {
  name: string;
  backend: string;
  focus: DesktopFocus | null;
  locked: boolean;
  /** Stopped locally (emergency stop) — nothing runs until resumed there. */
  paused: boolean;
  /** Why the focused window may not be typed into (password, not allowed), or null. */
  blocked: string | null;
  version: string;
  lastSeen: string;
  online: boolean;
}

/** Keys a person may press remotely — nothing that opens a shell or a menu. */
export const DESKTOP_KEYS = ["Return", "Tab", "Escape", "undo"] as const;
export type DesktopKey = (typeof DESKTOP_KEYS)[number];

export const MAX_DESKTOP_TEXT = 2000;

export const DesktopActionRequest = z
  .object({
    companion: z.string().min(1).max(80),
    kind: z.enum(["insert", "replace", "key"]),
    text: z.string().min(1).max(MAX_DESKTOP_TEXT).optional(),
    key: z.enum(DESKTOP_KEYS).optional(),
    /** The window the person saw in the preview. */
    target: z.object({ id: z.string().min(1).max(100), revision: z.number().int().nonnegative() }),
  })
  .refine((r) => (r.kind === "key" ? Boolean(r.key) && !r.text : Boolean(r.text) && !r.key), "insert/replace brauchen Text, key eine Taste");
export type DesktopActionRequest = z.infer<typeof DesktopActionRequest>;

export type DesktopActionStatus = "pending" | "delivered" | "running" | "done" | "failed" | "refused" | "cancelled" | "expired" | "uncertain";

export interface DesktopAction {
  id: string;
  companion: string;
  kind: "insert" | "replace" | "key";
  key: DesktopKey | null;
  /** Length only — the text itself is dropped once the action ended. */
  textLength: number;
  target: { id: string; revision: number; app: string; title: string };
  status: DesktopActionStatus;
  detail: string | null;
  typedChars: number;
  requestedBy: string;
  createdAt: string;
  updatedAt: string;
}

/** What the companion receives: the action plus the text to type. */
export interface DeliveredDesktopAction extends DesktopAction {
  text: string | null;
}

export const DesktopResult = z.object({
  status: z.enum(["running", "done", "failed", "refused"]),
  detail: z.string().max(500).nullable().default(null),
  typedChars: z.number().int().nonnegative().default(0),
});
export type DesktopResult = z.infer<typeof DesktopResult>;

export const CompanionStateReport = z.object({
  backend: z.string().max(40),
  focus: z.object({ id: z.string().max(100), app: z.string().max(200), title: z.string().max(500), revision: z.number().int().nonnegative() }).nullable(),
  locked: z.boolean(),
  paused: z.boolean(),
  blocked: z.string().max(200).nullable().default(null),
  version: z.string().max(40).default("0"),
});

/** Password managers, PIN/polkit prompts … by app id. */
const CREDENTIAL_APPS = /keepass|bitwarden|1password|pinentry|polkit|seahorse|gcr-prompter|keyring|lxqt-openssh-askpass|ssh-askpass/i;
/** … and dialogs that say what they want (not "login.ts" in an editor). */
const CREDENTIAL_TITLES = /\b(passwor[dt]|kennwort|passphrase|pin (eingeben|eintragen)|enter (your )?pin|authenti(cation|fizierung) (required|erforderlich)|zwei-faktor|two-factor|2fa-code)\b/i;

/**
 * T11.3 / AC-P11-4: windows that likely ask for a secret — never typed
 * into from remote, whatever the person dictated.
 */
export function credentialTarget(app: string, title: string): string | null {
  if (CREDENTIAL_APPS.test(app) || CREDENTIAL_TITLES.test(title)) return "Das Fenster fragt vermutlich nach einem Passwort oder Geheimnis — hier tippt der Companion nicht.";
  return null;
}
