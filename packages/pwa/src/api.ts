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
};
