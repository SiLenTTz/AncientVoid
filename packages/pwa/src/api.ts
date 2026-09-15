export interface SessionRecord {
  id: string;
  adapter: string;
  project: string;
  worktreeSha: string | null;
  status: string;
  createdAt: string;
  model: string | null;
  budgetUsd: number | null;
  adapterVersion: string;
  lastSeq: number;
  costUsd: number;
  updatedAt: string;
}

export interface AdapterInfo {
  id: string;
  version: string;
  capabilities: { reasoning: boolean; tools: boolean; cost: boolean; steer: boolean; usage: boolean };
}

/** ADR-0004 — account-level usage/quota window, e.g. claude's real
 * "five_hour"/"seven_day". `id` is a free string, not an enum. */
export interface UsageWindow {
  id: string;
  utilization: number;
  resetsAt: string;
}

export interface UsageQuota {
  windows: UsageWindow[];
  overageAvailable?: boolean;
  overageBlockedReason?: string;
}

export interface AdapterUsage {
  adapterId: string;
  /** Adapter-type capability (ADR-0004) — false means "verified absent for
   * this adapter", never a guess. */
  supported: boolean;
  /** null: no observation yet (or unsupported) — never a stale/implied 0%. */
  quota: UsageQuota | null;
  observedAt: string | null;
}

/** T1.5-4 — a host-discovered git repo, offered as a session project. */
export interface DiscoveredProject {
  path: string;
  name: string;
  branch: string | null;
}

export interface ProjectDiscoveryResult {
  projects: DiscoveredProject[];
  warnings: string[];
}

export type SteerInput =
  | { kind: "prompt"; text: string }
  | { kind: "stop" }
  | { kind: "park" }
  | { kind: "resume" };

export interface Ack {
  ok: boolean;
  detail?: string;
}

/** T1.5-8 — result of one prompt-enhance call. `costUsd` present only for
 * adapters that report a real cost (claude); never guessed for codex. */
export interface EnhanceResult {
  enhanced: string;
  costUsd?: number;
  latencyMs: number;
}

const TOKEN_KEY = "uacc.token";

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? "";
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${getToken()}`,
      ...(init?.headers ?? {}),
    },
  });
  const cachedAt = res.headers.get("X-UACC-Cached-At");
  if (cachedAt) {
    document.dispatchEvent(
      new CustomEvent("uacc:stale-data", { detail: cachedAt }),
    );
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export const hubApi = {
  health: () => api<{ ok: boolean; serverTime: string }>("/api/health"),
  adapters: () => api<AdapterInfo[]>("/api/adapters"),
  adapterUsage: (id: string) => api<AdapterUsage>(`/api/adapters/${id}/usage`),
  projects: () => api<ProjectDiscoveryResult>("/api/projects"),
  enhancePrompt: (adapter: string, project: string, text: string) =>
    api<EnhanceResult>("/api/prompt-enhance", { method: "POST", body: JSON.stringify({ adapter, project, text }) }),
  sessions: () => api<SessionRecord[]>("/api/sessions"),
  session: (id: string) => api<SessionRecord>(`/api/sessions/${id}`),
  events: (id: string, afterSeq = 0, limit = 500) =>
    api<{ seq: number; type: string; summary: string; ts: string; payload: unknown; blobRef: string | null }[]>(
      `/api/sessions/${id}/events?afterSeq=${afterSeq}&limit=${limit}`,
    ),
  createSession: (body: {
    adapter: string;
    project: string;
    prompt?: string;
    model?: string;
    budgetUsd?: number | null;
  }) =>
    api<SessionRecord>("/api/sessions", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  stopSession: (id: string) =>
    api<{ ok: boolean }>(`/api/sessions/${id}/stop`, { method: "POST" }),
  // T1.5-6: doesn't go through api<T>() — a rejected steer (e.g. "no
  // thread_id captured yet") comes back as a 422 with a real, meaningful
  // {ok:false, detail} body, and api<T>()'s generic !res.ok path would
  // throw a bare "422 Unprocessable Entity" instead of surfacing that
  // detail. Callers inspect ack.ok/ack.detail themselves.
  steer: async (id: string, input: SteerInput): Promise<Ack> => {
    const res = await fetch(`/api/sessions/${id}/steer`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${getToken()}` },
      body: JSON.stringify(input),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; detail?: string; error?: string };
    // Two possible failure shapes from the server: a rejected Ack
    // ({ok:false, detail}) or a validation error ({error}, e.g. empty
    // text) — normalize both into one Ack so callers only check one thing.
    if (typeof body.ok === "boolean") return { ok: body.ok, ...(body.detail ? { detail: body.detail } : {}) };
    return { ok: false, detail: body.error ?? `${res.status} ${res.statusText}` };
  },
};
