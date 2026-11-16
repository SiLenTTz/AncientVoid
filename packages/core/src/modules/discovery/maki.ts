import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DEFAULT_HOST_ID, type DiscoveredSession, type DiscoverySource } from "@ancientvoid/contracts";
import { clip, headAndTail, messageText, outsideRoots } from "./text.ts";

/**
 * maki (maki.sh) keeps `<state>/sessions/<id>.jsonl`: a `header` line (id, cwd, model), `msg` lines
 * (`d.role`, `d.content` blocks), one huge `frame` line (the system prompt) and a `meta` line (title,
 * updated_at) that is rewritten at the end. Verified on disk 2026-10-28 with maki 0.6.5.
 */
export function defaultMakiDir(): string {
  const base = process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
  return join(base, "maki", "sessions");
}

const HEAD_BYTES = 4 * 1024;
const TAIL_BYTES = 256 * 1024;
const LIVE_WINDOW_MS = 90_000;

const cache = new Map<string, { mtimeMs: number; size: number; item: Omit<DiscoveredSession, "observedAt" | "live"> | null; updatedAt: number | null }>();

function userText(entry: Record<string, unknown>): string | null {
  const d = entry.d as { role?: unknown; content?: unknown } | undefined;
  if (entry.t !== "msg" || d?.role !== "user") return null;
  const text = messageText(d.content).trim();
  return text || null;
}

function parseFile(path: string, size: number): { item: Omit<DiscoveredSession, "observedAt" | "live">; updatedAt: number | null } | null {
  const { head, tail } = headAndTail(path, size, HEAD_BYTES, TAIL_BYTES);
  const header = head.find((e) => e.t === "header") ?? tail.find((e) => e.t === "header");
  const id = typeof header?.id === "string" ? header.id : null;
  if (!id) return null;
  const meta = [...tail].reverse().find((e) => e.t === "meta");
  const metaTitle = typeof meta?.title === "string" ? meta.title : "";
  const last = tail.map(userText).filter((t) => t !== null).pop();
  const first = head.map(userText).find((t) => t !== null);
  return {
    item: {
      hubSessionId: null,
      project: typeof header?.cwd === "string" ? header.cwd : "",
      adapter: "maki",
      status: "observed",
      controlMode: "observed",
      harness: "cli",
      hostId: DEFAULT_HOST_ID,
      nativeSessionId: id,
      resumeVersion: 1,
      unsupportedResume: false,
      fork: false,
      parentSessionId: null,
      title: clip(metaTitle.split("\n")[0] ?? "", 80) ?? (first ? clip(first.split("\n")[0] ?? "", 80) : null),
      preview: last ? clip(last, 160) : null,
    },
    updatedAt: typeof meta?.updated_at === "number" ? meta.updated_at * 1000 : null,
  };
}

export function scanMakiSessions(dir: string, now = new Date().toISOString(), projectRoots: readonly string[] = []): DiscoveredSession[] {
  if (!existsSync(dir)) return [];
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return [unsupportedRow(dir, now, "unreadable")];
  }
  const roots = projectRoots.map((r) => resolve(r));
  const out: DiscoveredSession[] = [];
  for (const file of files) {
    const path = join(dir, file);
    let st;
    try {
      st = statSync(path);
    } catch {
      continue;
    }
    let entry = cache.get(path);
    if (!entry || entry.mtimeMs !== st.mtimeMs || entry.size !== st.size) {
      let parsed: ReturnType<typeof parseFile>;
      try {
        parsed = parseFile(path, st.size);
      } catch {
        parsed = null;
      }
      entry = { mtimeMs: st.mtimeMs, size: st.size, item: parsed?.item ?? null, updatedAt: parsed?.updatedAt ?? null };
      if (cache.size > 4000) cache.clear();
      cache.set(path, entry);
    }
    if (!entry.item) {
      out.push(unsupportedRow(dir, now, file));
      continue;
    }
    if (outsideRoots(entry.item.project, roots)) continue;
    const at = Math.max(entry.updatedAt ?? 0, st.mtimeMs);
    out.push({ ...entry.item, observedAt: new Date(at).toISOString(), live: Date.parse(now) - st.mtimeMs < LIVE_WINDOW_MS });
  }
  return out;
}

function unsupportedRow(where: string, now: string, why: string): DiscoveredSession {
  return {
    hubSessionId: null,
    project: where,
    adapter: "maki",
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

export function makiDiscoverySource(dir: string, projectRoots: readonly string[] = []): DiscoverySource {
  return { id: "maki-sessions", list: async () => scanMakiSessions(dir, new Date().toISOString(), projectRoots) };
}
