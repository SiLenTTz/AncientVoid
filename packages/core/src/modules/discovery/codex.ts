import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DEFAULT_HOST_ID, type DiscoveredSession } from "@ancientvoid/contracts";
import { classifyProject, clearTemporaryUnderRoots } from "./project-origin.ts";
import { clip, headAndTail, outsideRoots } from "./text.ts";

/**
 * EPIC-P34 T34.8: read-only Scanner für Codex-Rollouts, `~/.codex/sessions/YYYY/MM/DD/rollout-<zeit>-<uuid>.jsonl`.
 * Erste Zeile ist `session_meta` (id, cwd, source). Nutzertext steht als `response_item` mit Rolle `user`; davor liegen
 * eingespielte Hüllen (`<recommended_plugins>` …) und große Entwickler-Anweisungen — die erste echte Nutzerzeile lag auf
 * dem Entwicklungsrechner bis 124 KB tief, deshalb ein 256-KB-Kopffenster. Rollouts erreichen 66 MB: nur Kopf und Ende.
 *
 * Fortsetzen wird **nicht** angeboten (`unsupportedResume`): `codex resume` existiert (ADR-0036), aber der Codex-Adapter
 * nimmt keine fremde Session-ID zur Übernahme entgegen — ohne Ende-zu-Ende-Beleg bleibt es „nur beobachtet“.
 */
export function defaultCodexDir(): string {
  return join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "sessions");
}

const HEAD_BYTES = 256 * 1024;
const TAIL_BYTES = 128 * 1024;
const LIVE_WINDOW_MS = 90_000;
const IDE_REQUEST = /## My request for Codex:\s*([\s\S]*)$/;

type Parsed = Omit<DiscoveredSession, "observedAt" | "live">;
const cache = new Map<string, { mtimeMs: number; size: number; item: Parsed | null }>();

/** Codex-Inhalt: Blöcke `input_text`/`output_text` (nicht `text` wie bei Claude). */
function blockText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((b) => (b && typeof b === "object" && typeof (b as { text?: unknown }).text === "string" ? (b as { text: string }).text : "")).join(" ");
}

/** Was die Person gesagt hat: Hüllen, Datei-Anhänge und der IDE-Kopf zählen nicht, der IDE-Wunsch schon. */
function userTexts(entries: Record<string, unknown>[]): string[] {
  const out: string[] = [];
  for (const entry of entries) {
    const payload = entry.payload as { type?: unknown; role?: unknown; content?: unknown } | undefined;
    if (entry.type !== "response_item" || payload?.type !== "message" || payload.role !== "user") continue;
    let text = blockText(payload.content).trim();
    const ide = IDE_REQUEST.exec(text);
    if (ide) text = ide[1]!.trim();
    else if (text.startsWith("<") || text.startsWith("# Context from my IDE") || text.startsWith("# Files pasted by the user")) continue;
    if (text) out.push(text);
  }
  return out;
}

function parseFile(path: string, size: number): Parsed | null {
  const { head, tail } = headAndTail(path, size, HEAD_BYTES, TAIL_BYTES);
  const meta = head.find((e) => e.type === "session_meta")?.payload as { id?: unknown; session_id?: unknown; cwd?: unknown } | undefined;
  const id = typeof meta?.id === "string" ? meta.id : typeof meta?.session_id === "string" ? meta.session_id : null;
  if (!id || typeof meta?.cwd !== "string" || !meta.cwd) return null;
  const origin = classifyProject(meta.cwd);
  const first = userTexts(head)[0];
  const last = userTexts(tail).pop();
  const done = tail.filter((e) => e.type === "event_msg").map((e) => e.payload as { type?: unknown; last_agent_message?: unknown }).filter((p) => p.type === "task_complete" && typeof p.last_agent_message === "string").pop();
  return {
    hubSessionId: null,
    project: origin.project,
    adapter: "codex",
    status: "observed",
    controlMode: "observed",
    harness: "cli",
    hostId: DEFAULT_HOST_ID,
    nativeSessionId: id,
    resumeVersion: 1,
    unsupportedResume: true,
    fork: false,
    parentSessionId: null,
    title: first ? clip(first.split("\n").find((l) => l.trim()) ?? first, 80) : null,
    preview: clip(last ?? (done?.last_agent_message as string | undefined) ?? "", 160),
    worktree: origin.worktree,
    temporary: origin.temporary,
  };
}

function unsupported(where: string, now: string, why: string): DiscoveredSession {
  return {
    hubSessionId: null,
    project: where,
    adapter: "codex",
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

function rolloutFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string, depth: number) => {
    for (const name of readdirSync(d)) {
      const path = join(d, name);
      if (name.startsWith("rollout-") && name.endsWith(".jsonl")) out.push(path);
      else if (depth < 3) {
        try {
          if (statSync(path).isDirectory()) walk(path, depth + 1);
        } catch {
          // verschwunden während des Scans
        }
      }
    }
  };
  walk(dir, 0);
  return out;
}

/** Ein fehlender Speicher heißt „Codex nicht installiert“ (leer), ein unlesbarer oder fremder wird gemeldet (K9). */
export function scanCodexSessions(dir: string, now = new Date().toISOString(), projectRoots: readonly string[] = []): DiscoveredSession[] {
  if (!existsSync(dir)) return [];
  let files: string[];
  try {
    files = rolloutFiles(dir);
  } catch {
    return [unsupported(dir, now, "unreadable")];
  }
  const roots = projectRoots.map((r) => resolve(r));
  const out: DiscoveredSession[] = [];
  for (const path of files) {
    let st;
    try {
      st = statSync(path);
    } catch {
      continue;
    }
    let entry = cache.get(path);
    if (!entry || entry.mtimeMs !== st.mtimeMs || entry.size !== st.size) {
      let item: Parsed | null;
      try {
        item = parseFile(path, st.size);
      } catch {
        item = null;
      }
      entry = { mtimeMs: st.mtimeMs, size: st.size, item };
      if (cache.size > 4000) cache.clear();
      cache.set(path, entry);
    }
    const file = path.slice(path.lastIndexOf("/") + 1, -".jsonl".length);
    if (!entry.item) {
      out.push({ ...unsupported(dir, new Date(st.mtimeMs).toISOString(), file), nativeSessionId: `unknown:${file}` });
      continue;
    }
    if (outsideRoots(entry.item.project, roots)) continue;
    out.push({ ...entry.item, observedAt: new Date(st.mtimeMs).toISOString(), live: Date.parse(now) - st.mtimeMs < LIVE_WINDOW_MS });
  }
  clearTemporaryUnderRoots(out, roots);
  return out;
}

export function codexDiscoverySource(dir: string, projectRoots: readonly string[] = []) {
  return { id: "codex-sessions", list: async () => scanCodexSessions(dir, new Date().toISOString(), projectRoots) };
}
