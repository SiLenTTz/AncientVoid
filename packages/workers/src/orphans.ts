/**
 * BUG-0034: workers of throwaway hubs (messlauf, e2e without teardown)
 * survive their hub — nobody adopts them ever again (ADR-0014 recovery
 * needs a living hub with the same dataDir). Discovery + a safe decision:
 *
 * - A tmux server whose socket lives under a /tmp root without a live hub
 *   is a whole orphan — killed as a server (the messlauf pattern: one
 *   dedicated server per throwaway root).
 * - The default server carries the production hub's workers: a session is
 *   orphaned only when its `@ancientvoid_logdir` no longer exists on disk.
 *   Sessions without that marker (older hubs) stay — never guess.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

export const DEFAULT_SERVER = "default";

export interface ServerWorkers {
  /** "default" or the throwaway root the server's socket lives under. */
  server: string;
  sessions: {
    name: string;
    owner: string;
    logDir: string | null;
    /** T17.5/ADR-0037: @ancientvoid_session marker, when the spawning hub set it. */
    sessionId?: string;
    /** T17.6: pane cwd (#{pane_current_path}) — prune's fallback signal. */
    cwd?: string;
  }[];
}

export interface OrphanDecision {
  killServers: string[];
  killSessions: { server: string; name: string }[];
}

/** Every tmux server a ancientvoid worker could live in: the user's default plus
 * every /tmp root that carries a tmux socket (the throwaway pattern). */
export function discoverTmuxServers(tmp: string = tmpdir(), uid: number = process.getuid?.() ?? 0): string[] {
  const roots: string[] = [];
  for (const entry of readdirSync(tmp, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (existsSync(join(tmp, entry.name, `tmux-${uid}`, "default"))) roots.push(join(tmp, entry.name));
  }
  return roots;
}

/** Pure: what to kill, given the servers' sessions, the roots of live hubs
 * and a directory-existence check. Everything unmarked or live stays. */
export function decideOrphans(servers: readonly ServerWorkers[], liveRoots: ReadonlySet<string>, dirExists: (dir: string) => boolean): OrphanDecision {
  const decision: OrphanDecision = { killServers: [], killSessions: [] };
  for (const { server, sessions } of servers) {
    if (server === DEFAULT_SERVER) {
      for (const s of sessions) {
        if (s.logDir !== null && !dirExists(s.logDir)) decision.killSessions.push({ server, name: s.name });
      }
      continue;
    }
    if (liveRoots.has(server)) continue;
    if (sessions.length > 0) decision.killServers.push(server);
  }
  return decision;
}

function tmux(server: string, args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn("tmux", args, {
      env: { ...process.env, TMUX: "", ...(server !== DEFAULT_SERVER ? { TMUX_TMPDIR: server } : {}) },
      stdio: ["ignore", "pipe", "ignore"],
    });
    let stdout = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.on("error", () => resolve({ code: 1, stdout: "" }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout }));
  });
}

/** One server's ancientvoid sessions with their owner and log dir. */
export async function listServerWorkers(server: string): Promise<ServerWorkers> {
  const res = await tmux(server, [
    "list-sessions",
    "-F",
    "#{session_name}\t#{@ancientvoid_owner}\t#{@ancientvoid_logdir}\t#{@ancientvoid_session}\t#{pane_current_path}",
  ]);
  if (res.code !== 0) return { server, sessions: [] };
  const sessions = res.stdout
    .trim()
    .split("\n")
    .filter((l) => l.startsWith("ancientvoid-"))
    .map((l) => {
      const [name, owner, logDir, sessionId, cwd] = l.split("\t");
      return {
        name: name ?? "",
        owner: owner ?? "",
        logDir: logDir && logDir.length > 0 && logDir !== "" ? logDir : null,
        ...(sessionId ? { sessionId } : {}),
        ...(cwd ? { cwd } : {}),
      };
    })
    .filter((s) => s.name.length > 0);
  return { server, sessions };
}

/** Roots of running hubs: their ANCIENTVOID_CONFIG's directory (a hub lives in
 * its config's root — throwaway and production alike). Same user only. */
export function liveHubRoots(readEnviron: (pid: number) => string | null = readProcEnviron, pids: readonly number[] = processPids()): Set<string> {
  const roots = new Set<string>();
  for (const pid of pids) {
    const environ = readEnviron(pid);
    if (environ === null) continue;
    const match = /ANCIENTVOID_CONFIG=([^\0]+)/.exec(environ);
    if (match) roots.add(dirname(match[1]!));
  }
  return roots;
}

function processPids(): number[] {
  try {
    return readdirSync("/proc")
      .map((d) => Number(d))
      .filter((n) => Number.isInteger(n) && n > 0);
  } catch {
    return [];
  }
}

function readProcEnviron(pid: number): string | null {
  try {
    return readFileSync(`/proc/${pid}/environ`, "utf8");
  } catch {
    return null;
  }
}

/** Find what a prune would kill right now (dry run). */
export async function findOrphanedWorkers(tmp: string = tmpdir()): Promise<OrphanDecision> {
  const servers = [DEFAULT_SERVER, ...discoverTmuxServers(tmp)];
  const listed = await Promise.all(servers.map((s) => listServerWorkers(s)));
  return decideOrphans(listed, liveHubRoots(), (dir) => existsSync(dir));
}

/** Kill what findOrphanedWorkers found. Returns the decision it acted on. */
export async function pruneOrphanedWorkers(tmp: string = tmpdir()): Promise<OrphanDecision> {
  const decision = await findOrphanedWorkers(tmp);
  for (const server of decision.killServers) await tmux(server, ["kill-server"]);
  for (const { server, name } of decision.killSessions) await tmux(server, ["kill-session", "-t", name]);
  return decision;
}
