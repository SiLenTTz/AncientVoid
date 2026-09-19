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
  /** ADR-0006 — summed from real per-event usage where an adapter reports
   * it (claude); 0 means "unreported", not "confirmed zero" (same caveat
   * as costUsd). */
  tokensEst: number;
  /** T2.7/ADR-0008: why a "parked" session is paused — null otherwise, or
   * for a manually parked session that predates this field. */
  parkReason: "manual" | "budget" | "daily_cap" | null;
  /** Real user request (2026-09-19): continue the exact same worker from
   * a desktop terminal. Present only for a genuinely live session on a
   * genuinely tmux-backed hub (see routes.ts's withAttachCmd) — absent
   * otherwise, never a fabricated command. */
  attachCmd?: string;
}

/** T2.4/ADR-0007 — mirrors `@uacc/contracts`'s ApprovalRequest, same
 * duplication convention this file already uses for SessionRecord etc.
 * `read`-class never appears here — it's free and never queued. */
export type ApprovalClass = "read" | "write" | "destructive";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "timed_out";

export interface ApprovalRequest {
  id: string;
  sessionId: string;
  class: ApprovalClass;
  action: string;
  summary: string;
  createdAt: string;
  timeoutAt: string;
  status: ApprovalStatus;
  reasonRequired: boolean;
  reason: string | null;
  decidedAt: string | null;
  decidedByLabel: string | null;
  signature: string | null;
}

/** T3.8: one real qmd hit — `file` is relative to `project`, `line` is
 * the real anchor `qmd get`/a file viewer can jump to. */
export interface SearchResult {
  file: string;
  line: number;
  title: string;
  snippet: string;
  score: number;
}

export interface SearchStatus {
  qmdAvailable: boolean;
  indexed: boolean;
}

export interface SearchResponse {
  status: "indexing" | "ready";
  results: SearchResult[];
}

export interface ProjectFile {
  path: string;
  content: string;
  lineCount: number;
}

/** T2.2: one structured hunk — `functionContext` is git's own real
 * function/section-context heuristic (absent for some hunks/languages,
 * never guessed when missing). `collapsed` means `body` is a short
 * preview under K3, not the full hunk — fetch the rest via
 * `hubApi.sessionDiffHunk()`. */
export interface DiffHunk {
  header: string;
  functionContext: string | null;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  body: string;
  collapsed: boolean;
}

/** T1.6-4/T1.6-5 → T2.2 — shared by the Bericht tab's file count and the
 * Diff tab's patch view. `error` names a real reason (no git repo, no
 * changes) rather than a silently empty result. */
export interface SessionDiffFile {
  path: string;
  additions: number;
  deletions: number;
  binary: boolean;
  hunks: DiffHunk[];
}

export interface SessionDiffResult {
  files: SessionDiffFile[];
  patch: string;
  truncated: boolean;
  /** T2.2: the real ref this diff was computed against — the session's
   * worktree base_sha (T2.1) when isolated, else the literal "HEAD". */
  baseRef: string;
  error?: string;
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

/** T1.5-10/ADR-0005 — a skill or agent discovered in the target project's
 * own .claude/skills or .claude/agents. `kind: "workflow"` is reserved in
 * the data model but never produced by the scanner (no verified
 * convention exists for it, see EPIC-P1.5 §3.5). */
export interface SkillOrAgent {
  kind: "skill" | "agent" | "workflow";
  name: string;
  description: string;
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
  skills: (project: string) => api<{ items: SkillOrAgent[] }>(`/api/skills?project=${encodeURIComponent(project)}`),
  enhancePrompt: (adapter: string, project: string, text: string) =>
    api<EnhanceResult>("/api/prompt-enhance", { method: "POST", body: JSON.stringify({ adapter, project, text }) }),
  /** T3.9 (Learning-Loop, lokal, "niemals Cloud, niemals Telemetrie"): one
   * call per shown optimizer suggestion, whichever way the user decides.
   * 501 (no dataDir configured) is swallowed by the caller — this is a
   * best-effort local log, never something a user's send action should
   * wait on or fail over. */
  recordOptimizerFeedback: (entry: {
    adapter: string;
    project: string;
    original: string;
    enhanced: string;
    decision: "accepted" | "rejected";
    costUsd?: number;
    latencyMs: number;
  }) => api<{ ok: boolean }>("/api/prompt-optimizer/feedback", { method: "POST", body: JSON.stringify(entry) }),
  sessions: () => api<SessionRecord[]>("/api/sessions"),
  session: (id: string) => api<SessionRecord>(`/api/sessions/${id}`),
  sessionDiff: (id: string) => api<SessionDiffResult>(`/api/sessions/${id}/diff`),
  /** T3.8: real qmd-backed project search. A 501 (qmd not installed on
   * this host) is a real, expected state for a fresh/minimal deployment —
   * callers show it as "Suche nicht verfügbar", not a hard error. */
  searchStatus: (project: string) => api<SearchStatus>(`/api/search/status?project=${encodeURIComponent(project)}`),
  search: (project: string, q: string) =>
    api<SearchResponse>(`/api/search?project=${encodeURIComponent(project)}&q=${encodeURIComponent(q)}`),
  searchFile: (project: string, path: string) =>
    api<ProjectFile>(`/api/search/file?project=${encodeURIComponent(project)}&path=${encodeURIComponent(path)}`),
  /** T2.4/T2.6: the approval queue. 501 (approvals not configured on this
   * hub) is treated as "no queue" by callers, not a hard error — see
   * Approvals.tsx. */
  approvals: (status?: ApprovalStatus) =>
    api<ApprovalRequest[]>(`/api/approvals${status ? `?status=${status}` : ""}`),
  /** T2.7: request a higher budget for a parked-for-budget session.
   * Applied immediately (200) if this hub has no approvals configured,
   * otherwise parked pending a write-class approval (422, same
   * ack.ok===false shape as /steer). */
  requestBudgetTopUp: (id: string, budgetUsd: number, reason?: string) =>
    api<{ ok: boolean; detail?: string }>(`/api/sessions/${id}/budget`, {
      method: "POST",
      body: JSON.stringify({ budgetUsd, ...(reason ? { reason } : {}) }),
    }),
  decideApproval: (id: string, decision: "approve" | "reject", reason?: string) =>
    api<ApprovalRequest>(`/api/approvals/${id}/decide`, {
      method: "POST",
      body: JSON.stringify({ decision, ...(reason ? { reason } : {}) }),
    }),
  /** T2.5: WebAuthn passkey registration + the biometric decide path for
   * `destructive` approvals. 501 (webauthn not configured) is a real,
   * common state — same "feature genuinely absent" handling as the
   * approval queue's own 501. */
  webauthnStatus: () => api<{ registered: boolean }>("/api/webauthn/status"),
  // Fastify's JSON body parser rejects a POST with the JSON content-type
  // header (set unconditionally by api() below) but a truly empty body —
  // real bug found live-testing this against the actual server — so
  // these two no-payload POSTs send an explicit empty object instead.
  webauthnRegisterOptions: () => api<unknown>("/api/webauthn/register/options", { method: "POST", body: "{}" }),
  webauthnRegisterVerify: (response: unknown) =>
    api<{ ok: boolean }>("/api/webauthn/register/verify", { method: "POST", body: JSON.stringify(response) }),
  webauthnAssertOptions: (approvalId: string) =>
    api<unknown>(`/api/approvals/${approvalId}/webauthn/assert-options`, { method: "POST", body: "{}" }),
  decideApprovalBiometric: (approvalId: string, decision: "approve" | "reject", response: unknown, reason?: string) =>
    api<ApprovalRequest>(`/api/approvals/${approvalId}/webauthn/decide`, {
      method: "POST",
      body: JSON.stringify({ decision, response, ...(reason ? { reason } : {}) }),
    }),
  /** T2.2 expand-on-tap: full hunks for one file, after /diff collapsed them under K3. */
  sessionDiffHunk: (id: string, path: string) =>
    api<{ path: string; hunks: DiffHunk[] }>(`/api/sessions/${id}/diff/hunk?path=${encodeURIComponent(path)}`),
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
    args?: { skill?: string; agent?: string };
  }) =>
    api<SessionRecord>("/api/sessions", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  // Real, serious bug found live-testing T3.10's voice-stop directive:
  // this sent no body at all, but api()'s content-type: application/json
  // header is unconditional — Fastify rejects that combination with a
  // real 400 (FST_ERR_CTP_EMPTY_JSON_BODY). The UI's own "Stop" button
  // (SessionTail.tsx) calls this exact function and swallows the error
  // via `.catch(() => undefined)`, so the button has been silently doing
  // nothing this whole time — confirmed live via curl before assuming.
  stopSession: (id: string) =>
    api<{ ok: boolean }>(`/api/sessions/${id}/stop`, { method: "POST", body: "{}" }),
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
