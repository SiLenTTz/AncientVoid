import type { EmittedEvent, UsageQuota } from "@uacc/contracts";
import { summarize } from "./normalize.ts";

/**
 * `codex app-server` (v2 protocol, codex-cli 0.156.1, schema generated with
 * `codex app-server generate-json-schema`) → NormalizedEvents. Pure
 * functions; the adapter owns the connection.
 */

export interface CodexItem {
  type?: string;
  id?: string;
  text?: string;
  summary?: string[];
  content?: string[];
  command?: string;
  cwd?: string;
  status?: string;
  exitCode?: number | null;
  aggregatedOutput?: string | null;
  changes?: { path: string; kind?: unknown; diff?: string }[];
  server?: string;
  tool?: string;
  arguments?: unknown;
  result?: unknown;
  error?: unknown;
  query?: string;
}

/** Tool label on the approval card and in the history. */
export function toolOf(item: CodexItem): { name: string; input: Record<string, unknown> } | null {
  switch (item.type) {
    case "commandExecution":
      return { name: "Shell", input: { command: item.command ?? "", ...(item.cwd ? { cwd: item.cwd } : {}) } };
    case "fileChange":
      return { name: "Bearbeiten", input: { files: (item.changes ?? []).map((c) => c.path) } };
    case "mcpToolCall":
      return { name: `${item.server ?? "mcp"}.${item.tool ?? "tool"}`, input: item.arguments && typeof item.arguments === "object" ? (item.arguments as Record<string, unknown>) : {} };
    case "webSearch":
      return { name: "Web-Suche", input: { query: item.query ?? "" } };
    default:
      return null;
  }
}

export function itemStarted(item: CodexItem): EmittedEvent[] {
  const tool = toolOf(item);
  if (!tool) return [];
  return [{ type: "tool_use", summary: summarize(`${tool.name}(${JSON.stringify(tool.input).slice(0, 150)})`), payload: { id: item.id, name: tool.name, input: tool.input } }];
}

export function itemCompleted(item: CodexItem): EmittedEvent[] {
  switch (item.type) {
    case "agentMessage":
      return item.text ? [{ type: "assistant", summary: summarize(item.text), payload: { text: item.text } }] : [];
    case "reasoning": {
      const text = [...(item.summary ?? []), ...(item.content ?? [])].join("\n").trim();
      return text ? [{ type: "thinking", summary: summarize(text), payload: { text } }] : [];
    }
    case "commandExecution": {
      const failed = item.status !== "completed" || (item.exitCode !== null && item.exitCode !== undefined && item.exitCode !== 0);
      const content = item.status === "declined" ? "abgelehnt — nicht ausgeführt" : (item.aggregatedOutput ?? "");
      return [{ type: "tool_result", summary: summarize(content) || (failed ? "Befehl fehlgeschlagen" : "Befehl fertig"), payload: { toolUseId: item.id, isError: failed, content, exitCode: item.exitCode ?? null } }];
    }
    case "fileChange": {
      const paths = (item.changes ?? []).map((c) => c.path);
      const content = item.status === "declined" ? "abgelehnt — nicht geändert" : `geändert: ${paths.join(", ")}`;
      return [{ type: "tool_result", summary: summarize(content), payload: { toolUseId: item.id, isError: item.status !== "completed", content } }];
    }
    case "mcpToolCall":
    case "webSearch": {
      const content = JSON.stringify(item.result ?? item.error ?? {}).slice(0, 100_000);
      return [{ type: "tool_result", summary: summarize(content), payload: { toolUseId: item.id, isError: Boolean(item.error), content } }];
    }
    default:
      return [];
  }
}

/** turn/plan/updated → the todo shape the run strip reads. */
export function planEvent(plan: { step: string; status: string }[]): EmittedEvent {
  const status = (s: string) => (s === "inProgress" ? "in_progress" : s);
  return {
    type: "tool_use",
    summary: `Plan: ${plan.filter((p) => p.status === "completed").length}/${plan.length} erledigt`,
    payload: { name: "todowrite", input: { todos: plan.map((p) => ({ content: p.step, status: status(p.status) })) }, source: "codex.plan" },
  };
}

interface RateLimitWindow {
  usedPercent: number;
  windowDurationMins?: number | null;
  resetsAt?: number | null;
}

/** account rate limits → ADR-0004 quota (5-h and 7-day windows). */
export function quotaOf(rateLimits: { primary?: RateLimitWindow | null; secondary?: RateLimitWindow | null } | undefined): UsageQuota | undefined {
  const windows: UsageQuota["windows"] = [];
  for (const w of [rateLimits?.primary, rateLimits?.secondary]) {
    if (!w || typeof w.usedPercent !== "number" || typeof w.resetsAt !== "number") continue;
    const id = w.windowDurationMins === 300 ? "five_hour" : w.windowDurationMins === 10080 ? "seven_day" : `${w.windowDurationMins ?? "?"}min`;
    windows.push({ id, utilization: Math.min(1, Math.max(0, w.usedPercent / 100)), resetsAt: new Date(w.resetsAt * 1000).toISOString() });
  }
  return windows.length > 0 ? { windows } : undefined;
}
