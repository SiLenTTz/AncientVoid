import { execFile } from "node:child_process";

/**
 * EPIC-P15 T15.4: which Claude Code sessions are open at the PC right now.
 * `claude agents --json` lists interactive terminals (with pid) and background
 * sessions, each with the CLI's own name. The hub reads it; it never writes.
 */
export interface ClaudeLiveSession {
  sessionId: string;
  kind: "interactive" | "background";
  /** The name Claude Code gave the session (a good title when we have none). */
  name: string | null;
  cwd: string;
  pid: number | null;
  /** idle, busy, blocked … as the CLI reports it. */
  state: string | null;
}

export type AgentsRunner = (command: string) => Promise<string>;

const defaultRun: AgentsRunner = (command) =>
  new Promise((resolve, reject) => {
    execFile(command, ["agents", "--json"], { timeout: 5000, maxBuffer: 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });

export function parseClaudeAgents(json: string): ClaudeLiveSession[] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) throw new Error("claude agents --json: keine Liste");
  const out: ClaudeLiveSession[] = [];
  for (const raw of parsed) {
    const row = raw as Record<string, unknown>;
    if (typeof row.sessionId !== "string" || !row.sessionId) continue;
    out.push({
      sessionId: row.sessionId,
      kind: row.kind === "background" ? "background" : "interactive",
      name: typeof row.name === "string" && row.name ? row.name : null,
      cwd: typeof row.cwd === "string" ? row.cwd : "",
      pid: typeof row.pid === "number" ? row.pid : null,
      state: typeof row.status === "string" ? row.status : typeof row.state === "string" ? row.state : null,
    });
  }
  return out;
}

/** Short-lived cache: one process start serves every open session view. */
export class ClaudeLive {
  private readonly command: string;
  private readonly run: AgentsRunner;
  private readonly ttlMs: number;
  private cache: { at: number; sessions: ClaudeLiveSession[] } | null = null;
  /** Why the last read failed (CLI missing, too old …) — null when it worked. */
  lastError: string | null = null;

  constructor(command = "claude", run: AgentsRunner = defaultRun, ttlMs = 3000) {
    this.command = command;
    this.run = run;
    this.ttlMs = ttlMs;
  }

  async list(): Promise<ClaudeLiveSession[]> {
    if (this.cache && Date.now() - this.cache.at < this.ttlMs) return this.cache.sessions;
    try {
      const sessions = parseClaudeAgents(await this.run(this.command));
      this.lastError = null;
      this.cache = { at: Date.now(), sessions };
      return sessions;
    } catch (err) {
      // A CLI without `agents` (older version) is a normal state, not a failure of the hub.
      this.lastError = err instanceof Error ? err.message : String(err);
      // BUG-0049: a slow or failed read keeps the last good list (retry after the next TTL) — an
      // empty answer would make "am PC offen" blink away and back.
      const kept = this.cache?.sessions ?? [];
      this.cache = { at: Date.now(), sessions: kept };
      return kept;
    }
  }

  async find(sessionId: string): Promise<ClaudeLiveSession | null> {
    return (await this.list()).find((s) => s.sessionId === sessionId) ?? null;
  }
}
