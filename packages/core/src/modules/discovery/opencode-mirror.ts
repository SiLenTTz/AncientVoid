import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Read-only mirror of an externally observed opencode session (ADR-0011
 * Erweiterung): opencode keeps every conversation in its own SQLite store
 * (~/.local/share/opencode/opencode.db) — the same store the discovery
 * scan reads. This reader turns a native session's messages and parts
 * into chat events so the hub can show exactly the text the agent and its
 * user produced, without starting anything.
 *
 * Known limit, deliberately: tool parts import their call immediately,
 * but the result only if it was already completed when first read — a
 * running tool's late output is not re-imported (the part's creation
 * time never changes). Chat text (user, assistant, reasoning) is always
 * complete.
 */

/** What the session record needs from opencode's store. */
export interface OpenCodeMirrorInfo {
  title: string | null;
  project: string | null;
  /** Milliseconds — newest message time, "is anything happening" signal. */
  lastActivityMs: number | null;
}

/** One mirrored chat contribution, already hub-shaped (pre-seq/ts). */
export interface MirrorEventInput {
  type: "user" | "assistant" | "thinking" | "tool_use" | "tool_result";
  summary: string;
  payload: Record<string, unknown>;
  ts: string;
}

const MAX_TEXT = 3_500;

function clip(text: string): string {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}… [gespiegelt, gekürzt]` : text;
}

const msToIso = (ms: number | null | undefined): string | null =>
  typeof ms === "number" && Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;

interface PartRow {
  time_created: number | null;
  data: string | null;
  mdata: string | null;
}

/**
 * Reads the conversation delta of `nativeId`: every part created strictly
 * after `sinceMs` (epoch ms; 0 = full history), in conversation order,
 * mapped to hub events. Returns null when the store or session is gone —
 * the caller surfaces that loudly instead of showing an empty chat.
 */
export function readOpenCodeMirrorDelta(
  dataDir: string,
  nativeId: string,
  sinceMs: number,
): { info: OpenCodeMirrorInfo; watermark: number; events: MirrorEventInput[] } | null {
  const dbPath = join(dataDir, "opencode.db");
  if (!existsSync(dbPath)) return null;
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(`file:${dbPath}?mode=ro`, { readOnly: true });
  } catch {
    return null;
  }
  try {
    const session = db
      .prepare("SELECT title, directory, time_created, time_updated FROM session WHERE id = ?")
      .get(nativeId) as { title?: string | null; directory?: string | null; time_created?: number | null; time_updated?: number | null } | undefined;
    if (!session) return null;
    const rows = db
      .prepare(
        `SELECT p.time_created AS time_created, p.data AS data, m.data AS mdata
         FROM part p JOIN message m ON p.message_id = m.id
         WHERE p.session_id = ? AND p.time_created > ?
         ORDER BY p.time_created, p.id`,
      )
      .all(nativeId, sinceMs) as unknown as PartRow[];
    let watermark = sinceMs;
    const events: MirrorEventInput[] = [];
    for (const row of rows) {
      const created = typeof row.time_created === "number" ? row.time_created : null;
      if (created !== null && created > watermark) watermark = created;
      const part = safeJson(row.data);
      const message = safeJson(row.mdata);
      if (!part || typeof part.type !== "string") continue;
      const ts = msToIso(created) ?? new Date().toISOString();
      const partId = typeof part.id === "string" ? part.id : null;
      const role = message !== null && typeof message.role === "string" ? message.role : null;
      if (part.type === "text" && typeof part.text === "string" && part.text.length > 0) {
        const kind = "opencode.mirror";
        if (role === "user") {
          events.push({ type: "user", summary: clip(part.text), payload: { kind, text: clip(part.text), ...(partId ? { partId } : {}) }, ts });
        } else if (role === "assistant") {
          events.push({ type: "assistant", summary: clip(part.text), payload: { kind, text: clip(part.text), ...(partId ? { partId } : {}) }, ts });
        }
      } else if (part.type === "reasoning" && typeof part.text === "string" && part.text.length > 0) {
        events.push({ type: "thinking", summary: clip(part.text), payload: { kind: "opencode.mirror", text: clip(part.text), ...(partId ? { partId } : {}) }, ts });
      } else if (part.type === "tool" && typeof part.tool === "string") {
        const state = (part.state ?? {}) as { status?: string; input?: unknown; output?: unknown };
        events.push({
          type: "tool_use",
          summary: `${part.tool}: ${summarizeInput(state.input)}`,
          payload: { kind: "opencode.mirror", tool: part.tool, input: clipJson(state.input), ...(partId ? { partId } : {}) },
          ts,
        });
        if (state.status === "completed" || state.status === "error") {
          const output = typeof state.output === "string" ? state.output : JSON.stringify(state.output ?? null);
          events.push({
            type: "tool_result",
            summary: clip(output === "null" ? "" : output),
            payload: { kind: "opencode.mirror", isError: state.status === "error", content: clip(output === "null" ? "(keine Ausgabe)" : output), ...(partId ? { partId } : {}) },
            ts,
          });
        }
      }
      // step-start/step-finish/patch: transcript scaffolding, not chat —
      // skipped on purpose.
    }
    return {
      info: {
        title: typeof session.title === "string" && session.title.length > 0 ? session.title : null,
        project: typeof session.directory === "string" && session.directory.length > 0 ? session.directory : null,
        lastActivityMs: typeof session.time_updated === "number" ? session.time_updated : null,
      },
      watermark,
      events,
    };
  } catch {
    return null;
  } finally {
    db.close();
  }
}

function safeJson(raw: string | null): Record<string, unknown> | null {
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function summarizeInput(input: unknown): string {
  const json = JSON.stringify(input ?? {});
  return clip(json.length > 200 ? `${json.slice(0, 200)}…` : json === "{}" ? "{}" : json);
}

function clipJson(input: unknown): unknown {
  if (input !== null && typeof input === "object") {
    const json = JSON.stringify(input);
    if (json.length > MAX_TEXT) return { clipped: `${json.slice(0, MAX_TEXT)}…` };
    return input;
  }
  return input ?? {};
}
