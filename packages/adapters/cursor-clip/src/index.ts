import { z } from "zod";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type {
  Adapter,
  AdapterCapabilities,
  AdapterContext,
  Ack,
  HealthReport,
  SessionHandle,
  SessionSpec,
  SteerInput,
} from "@uacc/contracts";
import { decodeBubble, decodeComposerData } from "./normalize.ts";
import { defaultUserDir, findMostRecentComposerId, findWorkspaceId, openReadOnly, verifySchema } from "./workspace.ts";

/**
 * cursor-clip adapter (P3, T3.5): read-only observation of a real, live
 * Cursor Editor conversation via its own SQLite state — never drives
 * Cursor, never writes to its database, never sends it input. "may-break
 * by design" (README): Cursor owns this format and can change it without
 * notice; this adapter's job is to fail loud (K9 broken state), not to
 * guess around a format change.
 *
 * IMPORTANT: uses `spec.project` (the raw request field), never
 * `ctx.workdir` — T2.1's worktree isolation would otherwise hand this
 * adapter a freshly created `uacc/<sessionId>` worktree path that Cursor
 * has never heard of and has no `workspace.json` for. Cursor is watching
 * the REAL project directory the user actually opened it on.
 */

const CursorClipConfig = z.object({
  userDir: z.string().min(1).optional(),
  pollIntervalMs: z.number().int().positive().default(2000),
  /** Bounded backfill on start() so a freshly attached session isn't
   * blank — NOT a full history replay (a real conversation can have
   * thousands of bubbles; replaying all of them into an AncientVoid session tail
   * on every hub restart would itself be a K5/K7-shaped problem). "Clip"
   * means attach live, see recent context, then follow — not "replay
   * everything ever said". */
  seedBubbles: z.number().int().nonnegative().default(10),
});
type CursorClipConfig = z.infer<typeof CursorClipConfig>;

const CursorClipSessionArgs = z.object({ composerId: z.string().min(1).optional() }).optional();

interface ClipState {
  dbPath: string;
  composerId: string;
  lastIndex: number;
  timer: NodeJS.Timeout | undefined;
  broken: boolean;
  brokenDetail?: string;
  down: boolean;
  lastPollAt?: string;
  lastStatus?: string;
}

export function createAdapter(config?: Readonly<Record<string, unknown>>): Adapter {
  const cfg: CursorClipConfig = CursorClipConfig.parse(config ?? {});
  const userDir = cfg.userDir ?? defaultUserDir();
  const dbPath = join(userDir, "globalStorage", "state.vscdb");
  const states = new Map<string, ClipState>();

  function markBroken(state: ClipState, ctx: AdapterContext, detail: string): void {
    if (state.broken) return; // report once, not on every subsequent tick
    state.broken = true;
    state.brokenDetail = detail;
    ctx.emit({ type: "system", summary: `cursor-clip: broken — ${detail}`, payload: { kind: "cursor-clip.broken", detail } });
  }

  function poll(state: ClipState, ctx: AdapterContext): void {
    if (state.broken || state.down) return;
    let db: DatabaseSync;
    try {
      db = openReadOnly(state.dbPath);
    } catch (err) {
      state.down = true;
      ctx.emit({ type: "system", summary: "cursor-clip: database file no longer reachable", payload: { kind: "cursor-clip.down", error: String(err) } });
      return;
    }
    try {
      const schema = verifySchema(db);
      if (!schema.ok) {
        markBroken(state, ctx, schema.detail);
        return;
      }
      const row = db.prepare("SELECT value FROM cursorDiskKV WHERE key = ?").get(`composerData:${state.composerId}`) as
        | { value?: string }
        | undefined;
      if (!row?.value) {
        state.down = true;
        ctx.emit({ type: "system", summary: "cursor-clip: composer no longer found (closed or deleted in Cursor)", payload: { kind: "cursor-clip.composer_gone" } });
        return;
      }
      const parsed: unknown = JSON.parse(row.value);
      const summary = decodeComposerData(parsed);
      if (!summary) {
        markBroken(state, ctx, "composerData row no longer has a fullConversationHeadersOnly array");
        return;
      }
      if (summary.status && summary.status !== state.lastStatus) {
        state.lastStatus = summary.status;
        ctx.emit({
          type: "system",
          summary: `cursor-clip: composer status — ${summary.status}`,
          payload: { kind: "cursor-clip.status", status: summary.status, model: summary.modelName },
        });
      }
      for (; state.lastIndex < summary.headers.length; state.lastIndex++) {
        const header = summary.headers[state.lastIndex]!;
        const bubbleRow = db.prepare("SELECT value FROM cursorDiskKV WHERE key = ?").get(`bubbleId:${state.composerId}:${header.bubbleId}`) as
          | { value?: string }
          | undefined;
        if (!bubbleRow?.value) {
          ctx.emit({ type: "system", summary: "cursor-clip: bubble referenced in conversation index but not found (real race with Cursor's own writes)", payload: { kind: "cursor-clip.bubble_missing", bubbleId: header.bubbleId } });
          continue;
        }
        let bubbleParsed: unknown;
        try {
          bubbleParsed = JSON.parse(bubbleRow.value);
        } catch {
          ctx.emit({ type: "system", summary: "cursor-clip: bubble row is not valid JSON", payload: { kind: "cursor-clip.bubble_parse_error", bubbleId: header.bubbleId } });
          continue;
        }
        for (const event of decodeBubble(bubbleParsed)) ctx.emit(event);
      }
      state.lastPollAt = new Date().toISOString();
    } catch (err) {
      ctx.log("warn", "cursor-clip: poll failed", { error: String(err) });
    } finally {
      db.close();
    }
  }

  const adapter: Adapter = {
    id: "cursor-clip",
    version: "0.1.0",

    capabilities(): AdapterCapabilities {
      // steer: false — this is a read-only observer. reasoning: true real
      // `thinking` blocks exist. cost: false — no dollar figure anywhere
      // in the real capture (`usageData` observed empty). usage: false —
      // `contextTokensUsed`/`contextTokenLimit` are a per-conversation
      // context-window fill level, not ADR-0004's account-level
      // utilization+resetsAt shape; forcing it into UsageQuota would
      // fabricate a reset time that doesn't exist (R9.7).
      return { reasoning: true, tools: true, cost: false, steer: false, usage: false, nativeDiscovery: "read-only", nativeResume: "none", features: { followUp: false, interrupt: false, toolGate: "none", questions: false, modelChoice: "none", modelSwitch: false, permissionModes: [], skills: false, agents: false, images: false, files: false, contextFork: false } };
    },

    async start(spec: SessionSpec, ctx: AdapterContext): Promise<SessionHandle> {
      const args = CursorClipSessionArgs.safeParse(spec.args);
      const explicitComposerId = args.success ? args.data?.composerId : undefined;

      if (!existsSync(dbPath)) {
        throw new Error(`cursor-clip: no Cursor state database at ${dbPath} — is Cursor installed here? (config.userDir override if the install path differs)`);
      }

      const db = openReadOnly(dbPath);
      let composerId: string | undefined = explicitComposerId;
      try {
        const schema = verifySchema(db);
        if (!schema.ok) {
          // Schema break at start — still create the session so the user
          // sees *why* it's broken, rather than an opaque start() failure.
          const state: ClipState = { dbPath, composerId: "", lastIndex: 0, timer: undefined, broken: true, brokenDetail: schema.detail, down: false };
          states.set(ctx.sessionId, state);
          ctx.emit({ type: "system", summary: `cursor-clip: broken — ${schema.detail}`, payload: { kind: "cursor-clip.broken", detail: schema.detail } });
          return { sessionId: ctx.sessionId };
        }
        if (!composerId) {
          const workspaceId = findWorkspaceId(userDir, spec.project);
          if (!workspaceId) {
            throw new Error(`cursor-clip: no Cursor workspace found for project "${spec.project}" (no workspaceStorage/*/workspace.json matches) — open it in Cursor first, or pass args.composerId explicitly`);
          }
          composerId = findMostRecentComposerId(db, workspaceId);
          if (!composerId) {
            throw new Error(`cursor-clip: Cursor workspace found for "${spec.project}" but it has no non-archived conversation yet`);
          }
        }
      } finally {
        db.close();
      }

      const state: ClipState = { dbPath, composerId, lastIndex: 0, timer: undefined, broken: false, down: false };

      // Bounded seed: read current headers once, start `seedBubbles` from
      // the end instead of 0 — see CursorClipConfig.seedBubbles doc.
      const seedDb = openReadOnly(dbPath);
      try {
        const row = seedDb.prepare("SELECT value FROM cursorDiskKV WHERE key = ?").get(`composerData:${composerId}`) as { value?: string } | undefined;
        if (row?.value) {
          const summary = decodeComposerData(JSON.parse(row.value));
          if (summary) state.lastIndex = Math.max(0, summary.headers.length - cfg.seedBubbles);
        }
      } finally {
        seedDb.close();
      }

      states.set(ctx.sessionId, state);
      ctx.emit({ type: "system", summary: `cursor-clip: attached to composer ${composerId}`, payload: { kind: "cursor-clip.attached", composerId } });
      poll(state, ctx);
      state.timer = setInterval(() => poll(state, ctx), cfg.pollIntervalMs);
      ctx.signal.addEventListener("abort", () => clearInterval(state.timer));

      return { sessionId: ctx.sessionId };
    },

    async steer(handle: SessionHandle, input: SteerInput, ctx: AdapterContext): Promise<Ack> {
      const state = states.get(handle.sessionId);
      switch (input.kind) {
        case "stop":
          await adapter.stop(handle, ctx);
          return { ok: true };
        case "park":
          if (state?.timer) clearInterval(state.timer);
          if (state) state.timer = undefined;
          return { ok: true };
        case "configure":
          return { ok: false, detail: "cursor-clip: Modus und Modell lassen sich in dieser Session nicht wechseln" };
        case "resume":
          if (state && !state.timer && !state.broken && !state.down) {
            state.timer = setInterval(() => poll(state, ctx), cfg.pollIntervalMs);
          }
          return { ok: true };
        case "prompt":
          return { ok: false, detail: "cursor-clip is read-only — it cannot send input to Cursor, only observe it" };
      }
    },

    async status(handle: SessionHandle): Promise<HealthReport> {
      const state = states.get(handle.sessionId);
      if (!state) return { state: "down", detail: "no active clip" };
      if (state.broken) return { state: "broken", ...(state.brokenDetail !== undefined ? { detail: state.brokenDetail } : {}) };
      if (state.down) return { state: "down", detail: "Cursor conversation or database no longer reachable" };
      return { state: "healthy", ...(state.lastPollAt ? { lastSeen: state.lastPollAt } : {}) };
    },

    async stop(handle: SessionHandle): Promise<void> {
      const state = states.get(handle.sessionId);
      if (state?.timer) clearInterval(state.timer);
      states.delete(handle.sessionId);
    },

    // No recover(): a fresh start() re-attaches and re-seeds from the
    // conversation's current tail — the same real limitation this
    // adapter's whole design already embraces (see seedBubbles doc), not
    // a gap specific to hub-crash recovery.
  };

  return adapter;
}
