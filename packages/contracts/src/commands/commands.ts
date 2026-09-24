import { z } from "zod";
import type { PolicyOperation } from "../approvals/policy.ts";

/**
 * T9.1 / ADR-0027: one catalog of what a person can do in the hub — every
 * input channel (tap, CLI, MCP, text/AI) plans against it; there is no
 * second execution engine. A plan is data: the server resolves names to
 * IDs, checks policy per step and runs it through the existing routes.
 */

export type CommandRisk = "read" | "write" | "destructive";
/** Where a step runs: navigation and field edits in the PWA, the rest on the hub. */
export type CommandRunner = "client" | "hub";

export type ParamKind = "session" | "project" | "host" | "adapter" | "page" | "text" | "amount" | "action" | "field" | "filter" | "transform" | "bool";

export interface CommandParam {
  kind: ParamKind;
  optional?: boolean;
  /** Filled from the context (open session/field) when not said. */
  fromContext?: boolean;
}

export interface CommandSpec {
  id: string;
  /** What it does, in the words the preview shows. */
  label: string;
  risk: CommandRisk;
  runner: CommandRunner;
  params: Record<string, CommandParam>;
  /** Policy operation the hub checks for this step (null: client only). */
  policy: PolicyOperation | null;
}

/**
 * The catalog (AC-P9-1). `approvals.decide` and anything with a passkey or
 * an OS prompt is deliberately missing: those stay a person's tap, even
 * when asked for in words (ADR-0007, T7.9).
 */
export const COMMANDS = {
  "nav.open": { id: "nav.open", label: "Seite öffnen", risk: "read", runner: "client", params: { page: { kind: "page" } }, policy: null },
  "sessions.show": { id: "sessions.show", label: "Sessions zeigen", risk: "read", runner: "client", params: { filter: { kind: "filter", optional: true } }, policy: null },
  "session.open": { id: "session.open", label: "Session öffnen", risk: "read", runner: "client", params: { session: { kind: "session", fromContext: true } }, policy: null },
  "code.search": { id: "code.search", label: "Im Code suchen", risk: "read", runner: "client", params: { session: { kind: "session", fromContext: true }, text: { kind: "text" } }, policy: null },
  "field.fill": { id: "field.fill", label: "Feld ausfüllen", risk: "read", runner: "client", params: { field: { kind: "field", fromContext: true }, text: { kind: "text" } }, policy: null },
  "field.transform": { id: "field.transform", label: "Text bearbeiten", risk: "read", runner: "client", params: { field: { kind: "field", fromContext: true }, transform: { kind: "transform" } }, policy: null },
  "session.create": { id: "session.create", label: "Session starten", risk: "write", runner: "hub", params: { adapter: { kind: "adapter" }, project: { kind: "project" }, host: { kind: "host", optional: true }, text: { kind: "text", optional: true } }, policy: "sessions.create" },
  "session.prompt": { id: "session.prompt", label: "Antwort senden", risk: "write", runner: "hub", params: { session: { kind: "session", fromContext: true }, text: { kind: "text" } }, policy: "sessions.prompt" },
  "session.stop": { id: "session.stop", label: "Session beenden", risk: "write", runner: "hub", params: { session: { kind: "session", fromContext: true } }, policy: "sessions.stop" },
  "session.park": { id: "session.park", label: "Zug anhalten", risk: "write", runner: "hub", params: { session: { kind: "session", fromContext: true } }, policy: "sessions.park" },
  "session.archive": { id: "session.archive", label: "Session archivieren", risk: "write", runner: "hub", params: { session: { kind: "session", fromContext: true }, on: { kind: "bool", optional: true } }, policy: "sessions.archive" },
  "session.pin": { id: "session.pin", label: "Session anheften", risk: "write", runner: "hub", params: { session: { kind: "session", fromContext: true }, on: { kind: "bool", optional: true } }, policy: "sessions.archive" },
  "session.rename": { id: "session.rename", label: "Session umbenennen", risk: "write", runner: "hub", params: { session: { kind: "session", fromContext: true }, text: { kind: "text" } }, policy: "sessions.archive" },
  "session.budget": { id: "session.budget", label: "Budget setzen", risk: "write", runner: "hub", params: { session: { kind: "session", fromContext: true }, amount: { kind: "amount" } }, policy: "sessions.budget" },
  "session.apply": { id: "session.apply", label: "Ins Projekt übernehmen", risk: "write", runner: "hub", params: { session: { kind: "session", fromContext: true } }, policy: "sessions.apply" },
  "action.run": { id: "action.run", label: "Aktion ausführen", risk: "write", runner: "hub", params: { session: { kind: "session", fromContext: true }, action: { kind: "action" } }, policy: "actions.run" },
} as const satisfies Record<string, CommandSpec>;

export type CommandId = keyof typeof COMMANDS;

/**
 * UI flows that are NOT reachable by words, and why (AC-P9-1: named, not
 * forgotten). The planner answers these with "bitte selbst tippen".
 */
export const USER_ONLY_FLOWS: readonly { flow: string; why: string }[] = [
  { flow: "Freigabe entscheiden (Erlauben/Ablehnen)", why: "Die Entscheidung ist die Kontrolle selbst — ein Text-Auftrag darf sie nicht ersetzen (T7.2, ADR-0007)." },
  { flow: "Passkey registrieren und bestätigen", why: "WebAuthn braucht die Geste am Gerät." },
  { flow: "Gerätetoken wechseln, Tokens verwalten", why: "Zugangsdaten gehen nie durch ein Modell." },
  { flow: "Gemini-Schlüssel setzen", why: "Geheimnisse gehen nie durch ein Modell." },
  { flow: "Push erlauben", why: "Die Erlaubnis gibt das Betriebssystem, nicht die App." },
  { flow: "Host koppeln/entfernen", why: "Der Einladungscode ist ein Geheimnis." },
  { flow: "Dateien anhängen", why: "Die Dateiauswahl ist ein Dialog des Systems." },
];

export const PAGES = ["dashboard", "new", "settings", "approvals", "status", "discovery"] as const;
export const SESSION_FILTERS = ["waiting", "active", "recent", "all"] as const;
export const TRANSFORMS = ["correct", "shorten", "translate_en", "translate_de", "improve"] as const;
/** Fields the text entry can fill or rewrite (AC-P9-1 field catalog). */
export const FIELDS = ["reply", "new_prompt", "session_title", "code_query", "session_filter"] as const;

/** Where the person is when they type — bound to the plan (Premortem 1). */
export const CommandContext = z.object({
  page: z.enum(PAGES).or(z.literal("session")),
  hostId: z.string().nullable().default(null),
  sessionId: z.string().nullable().default(null),
  /** The session's inputRevision/lastSeq when the plan was made. */
  sessionRevision: z.number().int().nonnegative().nullable().default(null),
  field: z.enum(FIELDS).nullable().default(null),
  /** The field's current text (for transforms) — user text, never agent output. */
  fieldText: z.string().max(20_000).nullable().default(null),
});
export type CommandContext = z.infer<typeof CommandContext>;

export const PlanStep = z.object({
  op: z.string(),
  args: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
  /** Resolved target, readable ("alpha · claude · Parser-Tests") — shown before writing. */
  target: z.string().nullable(),
  risk: z.enum(["read", "write", "destructive"]),
  runner: z.enum(["client", "hub"]),
  summary: z.string(),
});
export type PlanStep = z.infer<typeof PlanStep>;

export const PlanQuestion = z.object({
  param: z.string(),
  question: z.string(),
  options: z.array(z.object({ value: z.string(), label: z.string() })).max(12),
});
export type PlanQuestion = z.infer<typeof PlanQuestion>;

export const CommandPlan = z.object({
  id: z.string(),
  text: z.string(),
  context: CommandContext,
  /** "rules" (deterministic), "model" (local LLM) or "none". */
  planner: z.enum(["rules", "model", "none"]),
  steps: z.array(PlanStep).max(5),
  /** Instead of guessing: ask (ambiguity, missing target). */
  question: PlanQuestion.nullable(),
  /** Why nothing can be done (unknown, user-only flow, model down). */
  refusal: z.string().nullable(),
  createdAt: z.string(),
});
export type CommandPlan = z.infer<typeof CommandPlan>;

export interface StepResult {
  op: string;
  ok: boolean;
  detail: string;
  /** For client steps, the hub hands back what the PWA should do. */
  client?: Record<string, string | number | boolean | null>;
}
