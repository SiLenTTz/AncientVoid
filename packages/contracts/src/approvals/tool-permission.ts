import { z } from "zod";

/**
 * ADR-0018 §3 / T7.2: a provider asks the hub before a tool runs (claude's
 * --permission-prompt-tool, ACP's session/request_permission). The hub turns
 * it into an approval the phone decides; reject and timeout never run it.
 */

/** Label prefix of the per-session token the permission bridge carries. It
 * may only ask and wait for its own session — never decide (an agent must
 * not release its own tools). */
export const BRIDGE_TOKEN_PREFIX = "bridge:";

export function bridgeTokenAllows(label: string, path: string): boolean {
  if (!label.startsWith(BRIDGE_TOKEN_PREFIX)) return false;
  const sessionId = label.slice(BRIDGE_TOKEN_PREFIX.length);
  const bare = path.split("?")[0] ?? path;
  return bare === `/api/sessions/${sessionId}/tool-permissions` || bare.startsWith(`/api/sessions/${sessionId}/tool-permissions/`);
}

/** The provider's own name for the question tool (claude AskUserQuestion). */
export const QUESTION_TOOLS = ["AskUserQuestion"] as const;

export const ToolPermissionRequest = z.object({
  toolName: z.string().min(1).max(200),
  input: z.record(z.string(), z.unknown()),
  /** Provider's id of this call — asking twice for the same id returns the
   * same request (a bridge that retried after a hub restart). */
  toolUseId: z.string().min(1).max(200).optional(),
});
export type ToolPermissionRequest = z.infer<typeof ToolPermissionRequest>;

export const ToolQuestionOption = z.object({ label: z.string(), description: z.string().optional() });
export const ToolQuestion = z.object({
  question: z.string(),
  header: z.string().optional(),
  options: z.array(ToolQuestionOption).default([]),
  multiSelect: z.boolean().default(false),
});
export type ToolQuestion = z.infer<typeof ToolQuestion>;

/** What the provider gets back — claude's permission-prompt-tool shape. */
export type ToolPermissionAnswer =
  | { behavior: "allow"; updatedInput: Record<string, unknown> }
  | { behavior: "deny"; message: string };

export type ToolPermissionPoll =
  | { state: "pending"; id: string }
  | { state: "answered"; id: string; answer: ToolPermissionAnswer };
