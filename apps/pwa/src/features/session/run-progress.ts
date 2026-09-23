import type { AdapterUsage, UsageQuota } from "../../shared/api.ts";
import type { NormalizedEvent } from "../../shared/ws.ts";

/**
 * How far the current turn is — only from the agent's own plan. An LLM turn
 * reports no percentage; the todo list it writes (OpenCode `todowrite`,
 * Claude `TodoWrite`, input `{ todos: [{ status }] }` per their docs) is the
 * one honest signal. Without a plan there is no percent, only elapsed time.
 */
export interface RunProgress {
  source: "todos" | "none";
  done: number;
  total: number;
  percent: number | null;
  elapsedMs: number;
  /** Linear extrapolation from elapsed time and plan progress. */
  etaMs: number | null;
}

const TODO_TOOL = /^todo[_-]?write$/i;

function todosOf(event: NormalizedEvent): { status?: unknown }[] | null {
  if (event.type !== "tool_use") return null;
  const payload = event.payload as { tool?: unknown; name?: unknown; input?: { todos?: unknown } };
  const tool = typeof payload.tool === "string" ? payload.tool : typeof payload.name === "string" ? payload.name : "";
  if (!TODO_TOOL.test(tool) || !Array.isArray(payload.input?.todos)) return null;
  return payload.input.todos as { status?: unknown }[];
}

export function runProgress(events: readonly NormalizedEvent[], status: string, now = Date.now()): RunProgress | null {
  if (status !== "working") return null;
  let start = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    if ((events[i]!.payload as { kind?: unknown }).kind === "session.prompt") {
      start = i;
      break;
    }
  }
  const turn = events.slice(start);
  const startedAt = turn[0] ? Date.parse(turn[0].ts) : now;
  const elapsedMs = Math.max(0, now - startedAt);
  const plan = [...turn].reverse().map(todosOf).find((todos) => todos !== null);
  if (!plan) return { source: "none", done: 0, total: 0, percent: null, elapsedMs, etaMs: null };
  const counted = plan.filter((t) => t.status !== "cancelled");
  const total = counted.length;
  const done = counted.filter((t) => t.status === "completed").length;
  if (total === 0) return { source: "none", done: 0, total: 0, percent: null, elapsedMs, etaMs: null };
  const ratio = done / total;
  return {
    source: "todos",
    done,
    total,
    percent: Math.round(ratio * 100),
    elapsedMs,
    etaMs: ratio > 0 && ratio < 1 ? Math.round((elapsedMs * (1 - ratio)) / ratio) : null,
  };
}

export function formatMinutes(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "< 1 min";
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

const WINDOW_LABELS: Record<string, string> = { five_hour: "5h", seven_day: "7d" };

export interface QuotaSummary {
  text: string;
  level: "ok" | "warn" | "err" | "none";
}

/**
 * What is left of the provider's quota, tightest window first. Sources, in
 * order: the adapter's own usage report (ADR-0004), else the provider's
 * limit error in this session (ADR-0015). Nothing known is said as such.
 */
export function quotaSummary(usage: Pick<AdapterUsage, "supported" | "quota"> | null, events: readonly NormalizedEvent[]): QuotaSummary {
  const quota: UsageQuota | null = usage?.supported ? usage.quota : null;
  if (quota && quota.windows.length > 0) {
    const windows = [...quota.windows].sort((a, b) => b.utilization - a.utilization);
    const text = windows
      .map((w) => {
        const left = Math.max(0, Math.round((1 - w.utilization) * 100));
        const reset = new Date(w.resetsAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
        return `${WINDOW_LABELS[w.id] ?? w.id}: ${left} % frei · reset ${reset}`;
      })
      .join(" · ");
    const worst = windows[0]!.utilization;
    return { text, level: worst >= 1 ? "err" : worst >= 0.9 ? "warn" : "ok" };
  }
  const limit = [...events].reverse().find((e) => {
    const p = e.payload as { kind?: unknown; category?: unknown };
    return p.kind === "provider.error" && p.category === "quota";
  });
  if (limit) {
    const p = limit.payload as { window?: unknown; resetAt?: unknown };
    const window = typeof p.window === "string" ? p.window : "Kontingent";
    const reset = typeof p.resetAt === "string" ? ` · frei ab ${p.resetAt}` : "";
    return { text: `${window}: erschöpft${reset}`, level: "err" };
  }
  return { text: "Kontingent: Provider meldet nichts", level: "none" };
}
