import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DEFAULT_HOST_ID, type DiscoveredSession, type DiscoverySource } from "@uacc/contracts";
import { clip, headAndTail, messageText, outsideRoots } from "./text.ts";

/**
 * Session stores of pi (badlogic/pi) and oh-my-pi (`omp`, a pi fork): one JSONL file per session,
 * `<dir>/<project>/<timestamp>_<uuid>.jsonl`, first a `session` entry (id, cwd), then `message` entries.
 * omp additionally writes a padded `title` entry in front (rewritten in place, so the title is at the head).
 * Verified on disk 2026-10-28: pi 1.4.0 (`~/.pi/agent/sessions`), omp 18.13.3 (`~/.omp/agent/sessions`).
 */
export function defaultPiDir(): string {
  return join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"), "sessions");
}

export function defaultOmpDir(): string {
  return join(homedir(), ".omp", "agent", "sessions");
}

const HEAD_BYTES = 64 * 1024;
const TAIL_BYTES = 128 * 1024;
const UUID_IN_NAME = /_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;
/** ADR-0040: written this recently = probably still open in its own terminal. */
const LIVE_WINDOW_MS = 90_000;

const cache = new Map<string, { mtimeMs: number; size: number; item: Omit<DiscoveredSession, "observedAt" | "live"> | null }>();

function userTexts(entries: Record<string, unknown>[]): string[] {
  const out: string[] = [];
  for (const entry of entries) {
    const message = entry.message as { role?: unknown; content?: unknown } | undefined;
    if (entry.type !== "message" || message?.role !== "user") continue;
    const text = messageText(message.content).trim();
    if (text) out.push(text);
  }
  return out;
}

function parseFile(adapter: string, path: string, size: number): Omit<DiscoveredSession, "observedAt" | "live"> | null {
  const { head, tail } = headAndTail(path, size, HEAD_BYTES, TAIL_BYTES);
  const session = head.find((e) => e.type === "session");
  const id = typeof session?.id === "string" ? session.id : (UUID_IN_NAME.exec(path)?.[1] ?? null);
  if (!id) return null;
  const cwd = typeof session?.cwd === "string" ? session.cwd : "";
  const named = head.find((e) => e.type === "title" && typeof e.title === "string" && e.title.trim());
  const info = head.concat(tail).find((e) => e.type === "session_info" && typeof e.name === "string" && e.name.trim());
  const first = userTexts(head)[0];
  const last = userTexts(tail).pop();
  const title = clip(String((named?.title as string | undefined) ?? (info?.name as string | undefined) ?? first ?? "").split("\n")[0] ?? "", 80);
  return {
    hubSessionId: null,
    project: cwd,
    adapter,
    status: "observed",
    controlMode: "observed",
    harness: "cli",
    hostId: DEFAULT_HOST_ID,
    nativeSessionId: id,
    resumeVersion: 1,
    unsupportedResume: false,
    fork: false,
    parentSessionId: null,
    title,
    preview: last ? clip(last, 160) : null,
  };
}

function unsupported(adapter: string, where: string, now: string, why: string): DiscoveredSession {
  return {
    hubSessionId: null,
    project: where,
    adapter,
    status: "unsupported-format",
    controlMode: "observed",
    harness: "cli",
    hostId: DEFAULT_HOST_ID,
    nativeSessionId: `unknown:${why}`,
    resumeVersion: 0,
    observedAt: now,
    unsupportedResume: true,
    fork: false,
    parentSessionId: null,
  };
}

/** Read-only scan; a missing store is simply "none" (the CLI may not be installed), an unreadable one is reported (K9). */
export function scanPiFamilySessions(adapter: string, dir: string, now = new Date().toISOString(), projectRoots: readonly string[] = []): DiscoveredSession[] {
  if (!existsSync(dir)) return [];
  let projects: string[];
  try {
    projects = readdirSync(dir);
  } catch {
    return [unsupported(adapter, dir, now, "unreadable")];
  }
  const roots = projectRoots.map((r) => resolve(r));
  const out: DiscoveredSession[] = [];
  for (const project of projects) {
    const projectDir = join(dir, project);
    let files: string[];
    try {
      if (!statSync(projectDir).isDirectory()) continue;
      files = readdirSync(projectDir).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const file of files) {
      const path = join(projectDir, file);
      let st;
      try {
        st = statSync(path);
      } catch {
        continue;
      }
      let entry = cache.get(path);
      if (!entry || entry.mtimeMs !== st.mtimeMs || entry.size !== st.size) {
        let item: Omit<DiscoveredSession, "observedAt" | "live"> | null;
        try {
          item = parseFile(adapter, path, st.size);
        } catch {
          item = null;
        }
        entry = { mtimeMs: st.mtimeMs, size: st.size, item };
        if (cache.size > 4000) cache.clear();
        cache.set(path, entry);
      }
      if (!entry.item) {
        out.push({ ...unsupported(adapter, projectDir, now, file), nativeSessionId: `unknown:${file}` });
        continue;
      }
      if (outsideRoots(entry.item.project, roots)) continue;
      out.push({ ...entry.item, observedAt: new Date(st.mtimeMs).toISOString(), live: Date.parse(now) - st.mtimeMs < LIVE_WINDOW_MS });
    }
  }
  return out;
}

export function piFamilyDiscoverySource(adapter: string, dir: string, projectRoots: readonly string[] = []): DiscoverySource {
  return { id: `${adapter}-sessions`, list: async () => scanPiFamilySessions(adapter, dir, new Date().toISOString(), projectRoots) };
}

/** Where a session's file lives (adoption needs the path: `pi --session <path>` finds sessions of other projects, an id does not). */
export function findPiFamilySessionFile(dir: string, sessionId: string): string | null {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) return null;
  try {
    for (const project of readdirSync(dir)) {
      const projectDir = join(dir, project);
      try {
        const hit = readdirSync(projectDir).find((f) => f.endsWith(`_${sessionId}.jsonl`));
        if (hit) return join(projectDir, hit);
      } catch {
        // not a directory
      }
    }
  } catch {
    return null;
  }
  return null;
}
