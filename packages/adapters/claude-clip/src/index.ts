import { z } from "zod";
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import type {
  Adapter,
  AdapterCapabilities,
  AdapterContext,
  Ack,
  HealthReport,
  SessionHandle,
  SessionSpec,
  SteerInput,
} from "@ancientvoid/contracts";
import { normalizeClaudeClipLine } from "./normalize.ts";
import { defaultClaudeDir, findMostRecentSessionFile, findProjectDir, findSessionFileById } from "./workspace.ts";

/**
 * claude-clip adapter (P3, T3.15): read-only observation of a real Claude
 * Code session via its own `~/.claude/projects/<cwd>/<sessionId>.jsonl`
 * transcript — never drives Claude Code, never writes to the transcript,
 * never sends it input. Same "may-break by design" (K9) posture as
 * `adapter-cursor-clip`: this is Anthropic's own CLI's internal file
 * format, not a published contract, and can change without notice — a
 * transcript line this adapter doesn't recognize becomes a visible
 * `system` event (see normalize.ts's fail-loud default case), never a
 * silent drop or a guess.
 *
 * Real user request (2026-09-19): "dieselben Sessions in der mobilen App
 * sehen wie im jeweiligen Tool auf dem Desktop" — this is option 2 of that
 * ask (observing a session that was started independently in the user's
 * own terminal, not via the hub), alongside the already-shipped tmux
 * `attachCmd` (option 1, `apps/hub/src/route-context.ts`'s `withAttachCmd`)
 * for hub-spawned sessions.
 *
 * IMPORTANT: uses `spec.project` (the raw request field), never
 * `ctx.workdir` — same reasoning as cursor-clip: T2.1's worktree isolation
 * would otherwise hand this adapter a freshly created `ancientvoid/<sessionId>`
 * worktree path that no real `claude` invocation has ever run in and thus
 * has no transcript directory for. Claude Code is watching the REAL
 * directory the user actually ran it in.
 */

const ClaudeClipConfig = z.object({
  claudeDir: z.string().min(1).optional(),
  pollIntervalMs: z.number().int().positive().default(1500),
  /** Bounded backfill on start() — same reasoning as cursor-clip's
   * `seedBubbles`: a real transcript can be tens of megabytes (this
   * session's own file is one example); replaying it all into a fresh
   * AncientVoid session tail on every attach would itself be a K5/K7-shaped
   * problem. "Clip" means attach live, see recent context, then follow. */
  seedLines: z.number().int().nonnegative().default(30),
});
type ClaudeClipConfig = z.infer<typeof ClaudeClipConfig>;

const ClaudeClipSessionArgs = z.object({ sessionId: z.string().min(1).optional() }).optional();

interface ClipState {
  filePath: string;
  /** Byte offset of the start of the first not-yet-fully-consumed line.
   * Deliberately does NOT advance past a trailing partial (not-yet-
   * newline-terminated) line — that line's bytes are re-read from disk on
   * every poll, growing, until a `\n` completes it. No separate in-memory
   * "pending partial" buffer: keeping the offset behind it and always
   * re-reading from disk is what avoids double-counting those bytes. */
  byteOffset: number;
  timer: NodeJS.Timeout | undefined;
  down: boolean;
  lastPollAt?: string;
}

/** Reads the *complete* lines currently available starting at `fromByte`,
 * returning them plus the offset to resume from (the start of the still-
 * incomplete trailing line, if any — see ClipState.byteOffset's doc). */
function readNewLines(filePath: string, fromByte: number): { lines: string[]; nextOffset: number } {
  const size = statSync(filePath).size;
  if (size <= fromByte) return { lines: [], nextOffset: fromByte };
  const fd = openSync(filePath, "r");
  try {
    const length = size - fromByte;
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, fromByte);
    const chunk = buffer.toString("utf8");
    const parts = chunk.split("\n");
    const partial = parts.pop() ?? "";
    const consumedBytes = Buffer.byteLength(chunk, "utf8") - Buffer.byteLength(partial, "utf8");
    return { lines: parts.filter((l) => l.length > 0), nextOffset: fromByte + consumedBytes };
  } finally {
    closeSync(fd);
  }
}

function parseAndEmit(lines: string[], ctx: AdapterContext): void {
  for (const raw of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      ctx.emit({ type: "system", summary: "claude-clip: transcript line is not valid JSON", payload: { kind: "claude-clip.parse_error" } });
      continue;
    }
    for (const event of normalizeClaudeClipLine(parsed)) ctx.emit(event);
  }
}

export function createAdapter(config?: Readonly<Record<string, unknown>>): Adapter {
  const cfg: ClaudeClipConfig = ClaudeClipConfig.parse(config ?? {});
  const claudeDir = cfg.claudeDir ?? defaultClaudeDir();
  const states = new Map<string, ClipState>();

  function poll(state: ClipState, ctx: AdapterContext): void {
    if (state.down) return;
    if (!existsSync(state.filePath)) {
      state.down = true;
      ctx.emit({ type: "system", summary: "claude-clip: transcript file no longer reachable", payload: { kind: "claude-clip.down" } });
      return;
    }
    try {
      const { lines, nextOffset } = readNewLines(state.filePath, state.byteOffset);
      state.byteOffset = nextOffset;
      parseAndEmit(lines, ctx);
      state.lastPollAt = new Date().toISOString();
    } catch (err) {
      ctx.log("warn", "claude-clip: poll failed", { error: String(err) });
    }
  }

  const adapter: Adapter = {
    id: "claude-clip",
    version: "0.1.0",

    capabilities(): AdapterCapabilities {
      // steer: false — read-only observer, cannot send input to Claude
      // Code. cost: false — this transcript format has no aggregate-cost
      // record (no `result` line like the CLI's own `stream-json` output).
      // usage: false — per-message `usage.input_tokens`/`output_tokens`
      // are real but are a per-turn token count, not ADR-0004's
      // account-level utilization+resetsAt window; no rate-limit/quota
      // record was observed anywhere in this transcript format (R9.7 —
      // unbekannt statt geraten, same reasoning as cursor-clip's own
      // capabilities() comment).
      return { reasoning: true, tools: true, cost: false, steer: false, usage: false, nativeDiscovery: "read-only", nativeResume: "none", features: { followUp: false, interrupt: false, toolGate: "none", questions: false, modelChoice: "none", modelSwitch: false, permissionModes: [], skills: false, agents: false, images: false, files: false, contextFork: false } };
    },

    async start(spec: SessionSpec, ctx: AdapterContext): Promise<SessionHandle> {
      const args = ClaudeClipSessionArgs.safeParse(spec.args);
      const explicitSessionId = args.success ? args.data?.sessionId : undefined;

      const projectDir = findProjectDir(claudeDir, spec.project);
      if (!projectDir) {
        throw new Error(
          `claude-clip: no ~/.claude/projects directory for "${spec.project}" — has Claude Code ever been run there? (config.claudeDir override if the install path differs)`,
        );
      }

      const filePath = explicitSessionId
        ? findSessionFileById(projectDir, explicitSessionId)
        : findMostRecentSessionFile(projectDir);
      if (!filePath) {
        throw new Error(
          explicitSessionId
            ? `claude-clip: no transcript "${explicitSessionId}.jsonl" under ${projectDir}`
            : `claude-clip: no session transcripts (*.jsonl) under ${projectDir} yet`,
        );
      }

      // Bounded seed: read the file once, emit only the last `seedLines`
      // raw lines' events, then resume tailing from the file's current
      // end-of-file byte offset.
      const size = statSync(filePath).size;
      const raw = readFileSync(filePath, "utf8");
      const allLines = raw.split("\n").filter((l) => l.length > 0);
      const seedLines = cfg.seedLines > 0 ? allLines.slice(-cfg.seedLines) : [];

      const state: ClipState = { filePath, byteOffset: size, timer: undefined, down: false };
      states.set(ctx.sessionId, state);

      ctx.emit({
        type: "system",
        summary: `claude-clip: attached to ${filePath.split("/").pop()}`,
        payload: { kind: "claude-clip.attached", filePath },
      });
      parseAndEmit(seedLines, ctx);

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
          return { ok: false, detail: "claude-clip: Modus und Modell lassen sich in dieser Session nicht wechseln" };
        case "resume":
          if (state && !state.timer && !state.down) {
            state.timer = setInterval(() => poll(state, ctx), cfg.pollIntervalMs);
          }
          return { ok: true };
        case "prompt":
          return { ok: false, detail: "claude-clip is read-only — it cannot send input to Claude Code, only observe it" };
      }
    },

    async status(handle: SessionHandle): Promise<HealthReport> {
      const state = states.get(handle.sessionId);
      if (!state) return { state: "down", detail: "no active clip" };
      if (state.down) return { state: "down", detail: "transcript file no longer reachable" };
      return { state: "healthy", ...(state.lastPollAt ? { lastSeen: state.lastPollAt } : {}) };
    },

    async stop(handle: SessionHandle): Promise<void> {
      const state = states.get(handle.sessionId);
      if (state?.timer) clearInterval(state.timer);
      states.delete(handle.sessionId);
    },

    // No recover(): a fresh start() re-attaches to the most recent
    // transcript and re-seeds from its current tail — same real limitation
    // this adapter's whole design already embraces (see seedLines doc),
    // not a gap specific to hub-crash recovery. Matches cursor-clip.
  };

  return adapter;
}
