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
  /** T7.7 (ADR-0023): how far costUsd/tokensEst can be trusted. Missing
   * from older hubs. */
  metrics?: {
    cost: "unknown" | "partial" | "estimated" | "native";
    tokens: "unknown" | "partial" | "estimated" | "native";
    counters: { turns: number; costTurns: number; tokenTurns: number };
  };
  /** T2.7/ADR-0008: why a "parked" session is paused — null otherwise, or
   * for a manually parked session that predates this field. */
  parkReason: "manual" | "budget" | "daily_cap" | null;
  /** Real user request (2026-09-19): continue the exact same worker from
   * a desktop terminal. Present only for a genuinely live session on a
   * genuinely tmux-backed hub (see routes.ts's withAttachCmd) — absent
   * otherwise, never a fabricated command. */
  attachCmd?: string;
  /** T5.5: terminal command that opens this provider session natively on
   * the PC; only present between turns and when the native id is known. */
  openCmd?: string;
  /** EPIC-P6: the hub this session lives on (absent on old hubs). */
  hostId?: string;
  /** First line of the start prompt (null for sessions without one). */
  title?: string | null;
  /** Session files live in their own git worktree, not the project checkout. */
  worktree?: { path: string; branch: string };
  /** Hidden from the overview until the Archiv chip is on. */
  archived?: boolean;
  /** T8.6: pinned to the top of the overview. */
  pinned?: boolean;
  /** P5: counts prompts; a plan made on an older value is refused (T9.3). */
  inputRevision?: number;
  /** T8.1: the last understandable action (absent on older hubs). */
  lastActivity?: { text: string; type: string; at: string } | null;
}

/** T2.4/ADR-0007 — mirrors `@uacc/contracts`'s ApprovalRequest, same
 * duplication convention this file already uses for SessionRecord etc.
 * `read`-class never appears here — it's free and never queued. */
export type ApprovalClass = "read" | "write" | "destructive";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "timed_out";

/** T7.2 — mirrors `@uacc/contracts`'s ToolQuestion (claude AskUserQuestion). */
export interface ToolQuestion {
  question: string;
  header?: string;
  options: { label: string; description?: string }[];
  multiSelect: boolean;
}

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
  /** T7.2: a provider's own tool request or question. */
  tool?: { name: string; input: string; questions?: ToolQuestion[] };
  /** T7.3: what the decision released and what became of it. */
  operation?: { state: "pending" | "rejected" | "timed_out" | "dispatching" | "done" | "failed" | "uncertain"; outcome: string | null };
  /** T7.9: the gatekeeper's label (never a decision). */
  assessment?: ToolAssessment | null;
}

export interface ToolAssessment {
  toolRisk: "READ_ONLY" | "LOCAL_WRITE" | "DESTRUCTIVE" | "EXFILTRATION";
  securityGate: "CLEAN" | "WARNING" | "CRITICAL_BLOCK";
  source: "model" | "rules" | "fallback";
  confidence: { toolRisk: number | null; securityGate: number | null };
  model: string | null;
  latencyMs: number | null;
  notes: string[];
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

/** T7.6: which checkout a code view shows. */
export interface WorkspaceIdentity {
  kind: "session" | "project";
  sessionId: string | null;
  root: string;
  branch: string | null;
  head: string | null;
  base: string | null;
}

export interface CodeMatch {
  path: string;
  line: number;
  column: number;
  text: string;
  kind: "definition" | "match";
}

export interface CodeSearchResult {
  identity: WorkspaceIdentity;
  engine: "ripgrep" | "git-grep";
  matches: CodeMatch[];
  truncated: boolean;
}

export interface CodeFile {
  identity: WorkspaceIdentity;
  path: string;
  language: string;
  bytes: number;
  lines: number;
  content: string;
  truncated: boolean;
  binary: boolean;
  blobSha: string | null;
  changed: { additions: number; deletions: number } | null;
}

export interface ActionDefinition {
  id: string;
  label: string;
  kind: "test" | "git" | "tool";
  argv: string[];
  params: Record<string, { description: string; pattern: string; optional: boolean }>;
  readOnly: boolean;
  timeoutMs: number;
}

export interface ActionRun {
  id: string;
  sessionId: string;
  actionId: string;
  argv: string[];
  status: "running" | "succeeded" | "failed" | "timeout";
  exitCode: number | null;
  startedAt: string;
  endedAt: string | null;
  actor: string | null;
  output: string;
  outputTruncated: boolean;
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

/** ADR-0017 — one host in the fleet overview. */
export interface FleetHost {
  hostId: string;
  self: boolean;
  url: string | null;
  state: "reachable" | "stale" | "offline" | "incompatible" | "unauthorized";
  lastSyncAt: string | null;
  detail: string | null;
  sessions: number;
}

export interface FleetOverview {
  self: string;
  hosts: FleetHost[];
  sessions: SessionRecord[];
}

/** ADR-0017 — a paired hub (never with its token). */
export interface FleetPeer {
  hostId: string;
  url: string;
  protocolVersion: number;
  pairedAt: string;
}

/** ADR-0015 — cross-session notification from the hub. */
export interface HubNotification {
  id: number;
  sessionId: string;
  level: "info" | "success" | "warning" | "error";
  title: string;
  detail: string | null;
  kind: string;
  createdAt: string;
}

/** ADR-0011 — one session found by the hub or a read-only provider scan. */
export interface DiscoveredSession {
  hubSessionId: string | null;
  project: string;
  adapter: string;
  status: string;
  controlMode: "observed" | "managed" | "controllable";
  harness: string;
  hostId: string;
  nativeSessionId: string | null;
  observedAt: string;
  unsupportedResume: boolean;
  fork: boolean;
  parentSessionId: string | null;
}

export interface DiscoveryPage {
  items: DiscoveredSession[];
  nextCursor: number | null;
}

/** ADR-0012 — probed harness with its honest support cells. */
export interface HarnessInventoryEntry {
  id: string;
  harness: string;
  version: string | null;
  discovery: "verified" | "implemented-unverified" | "missing" | "blocked";
  resume: "verified" | "implemented-unverified" | "missing" | "blocked";
  evidence: string;
}

/** ADR-0018 — mirrors `@uacc/contracts`'s HarnessFeatures. */
export type ToolGate = "native" | "sandbox" | "allowlist" | "bypass" | "none";
export interface HarnessFeatures {
  followUp: boolean;
  interrupt: boolean;
  toolGate: ToolGate;
  questions: boolean;
  modelChoice: "start" | "none";
  skills: boolean;
  agents: boolean;
  images: boolean;
  files: boolean;
  contextFork: boolean;
}

export interface AdapterInfo {
  id: string;
  version: string;
  capabilities: { reasoning: boolean; tools: boolean; cost: boolean; steer: boolean; usage: boolean; features: HarnessFeatures };
}

export interface ModelOption {
  id: string;
  label?: string;
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

/** T1.5-10/ADR-0005 — a skill, agent, or workflow discovered in the target
 * project's `.claude/skills`, `.claude/agents`, or `.claude/workflows`.
 * Workflows have no adapter invocation (ADR-0005); the UI puts the name
 * in the prompt instead. */
export interface SkillOrAgent {
  kind: "skill" | "agent" | "workflow";
  name: string;
  description: string;
}

export interface PromptRecommendation {
  mode: "match" | "create";
  kind: "skill" | "agent" | "workflow";
  name: string;
  description: string;
  reason: string;
  draft: string | null;
}

/** T7.10 — mirrors `@uacc/contracts`'s AttachmentRecord. */
export interface AttachmentRecord {
  id: string;
  name: string;
  mimeType: string;
  bytes: number;
  kind: "image" | "pdf" | "office" | "text" | "audio" | "video" | "other";
  createdAt: string;
  extraction: { status: "pending" | "done" | "failed" | "none"; method: string | null; chars: number; error: string | null };
}

export type SteerInput =
  | { kind: "prompt"; text: string; attachmentIds?: string[] }
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
  // T8.2/AC-P8-4: another token is another person's device state — drafts
  // and cached views of the previous one must not show up.
  if (localStorage.getItem(TOKEN_KEY) !== token) {
    for (const key of Object.keys(localStorage)) if (key.startsWith("uacc.draft.") || key.startsWith("uacc.newSession") || key.startsWith("uacc.tail.")) localStorage.removeItem(key);
    void caches?.delete?.("uacc-api").catch(() => undefined);
  }
  localStorage.setItem(TOKEN_KEY, token);
}

/** T9: a plan for one text instruction (ADR-0027). */
export interface PlanStep {
  op: string;
  args: Record<string, string | number | boolean | null>;
  target: string | null;
  risk: "read" | "write" | "destructive";
  runner: "client" | "hub";
  summary: string;
}

export interface CommandPlan {
  id: string;
  text: string;
  planner: "rules" | "model" | "none";
  steps: PlanStep[];
  question: { param: string; question: string; options: { value: string; label: string }[] } | null;
  refusal: string | null;
}

export interface StepResult {
  op: string;
  ok: boolean;
  detail: string;
  client?: Record<string, string | number | boolean | null>;
}

/** T8.3: Web Push state of this hub, subscriptions with delivery status. */
export interface PushState {
  enabled: boolean;
  publicKey: string | null;
  subscriptions: {
    id: number;
    device: string | null;
    service: string;
    createdAt: string;
    quiet: { from: number; to: number; tzOffsetMinutes: number } | null;
    done: boolean;
    lastOkAt: string | null;
    lastError: string | null;
    lastErrorAt: string | null;
    gone: boolean;
    mine: boolean;
  }[];
}

/** T8.4: a session's shared, revisioned draft (ADR-0025). */
export interface SessionDraft {
  sessionId: string;
  text: string;
  attachmentIds: string[];
  revision: number;
  updatedAt: string | null;
  device: string | null;
}

const CLIENT_KEY = "uacc.clientId";

function randomId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** One id per device. The hub leases a session to the device that wrote
 * last, so phone and desktop cannot both start a turn (AC-P5-4). */
export function clientId(): string {
  let id = localStorage.getItem(CLIENT_KEY);
  if (!id) {
    id = randomId();
    localStorage.setItem(CLIENT_KEY, id);
  }
  return id;
}

/** A fresh id for one send. A retry of the same send reuses it, so the
 * hub runs it once. */
export function newInputId(): string {
  return randomId();
}

/** Server ack details that mean "someone else holds the session". */
export function steerRejectText(detail: string | undefined): string {
  if (detail === "writer lease held") return "Ein anderes Gerät schreibt gerade in diese Session. Warten oder übernehmen.";
  if (detail === "revision conflict") return "Die Session hat sich inzwischen geändert. Bitte erneut senden.";
  return detail ?? "Antwort wurde abgelehnt";
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
    throw Object.assign(new Error(body.error ?? `${res.status} ${res.statusText}`), { status: res.status });
  }
  return (await res.json()) as T;
}

/** T8.2: only a real 401/403 says the token is wrong — offline is not. */
export function isAuthError(err: unknown): boolean {
  const status = (err as { status?: unknown })?.status;
  return status === 401 || status === 403;
}

/** All hub calls. `P` maps a path to its host (ADR-0017 routing). */
function createHubApi(P: (path: string) => string) {
  return {
  health: () => api<{ ok: boolean; serverTime: string }>(P("/api/health")),
  adapters: () => api<AdapterInfo[]>(P("/api/adapters")),
  /** T7.10: a file into the hub — raw bytes, name in a header. */
  uploadAttachment: async (file: File): Promise<AttachmentRecord> => {
    const res = await fetch(P("/api/attachments"), {
      method: "POST",
      headers: { "content-type": file.type || "application/octet-stream", "x-filename": encodeURIComponent(file.name), authorization: `Bearer ${getToken()}` },
      body: file,
    });
    const body = (await res.json().catch(() => ({}))) as AttachmentRecord & { error?: string };
    if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
    return body;
  },
  attachment: (id: string) => api<AttachmentRecord>(P(`/api/attachments/${id}`)),
  attachmentText: (id: string) => api<{ extraction: AttachmentRecord["extraction"]; text: string | null }>(P(`/api/attachments/${id}/text`)),
  /** The file itself as an object URL — the token stays in a header, never in a URL. */
  attachmentUrl: async (id: string): Promise<string> => {
    const res = await fetch(P(`/api/attachments/${id}/content`), { headers: { authorization: `Bearer ${getToken()}` } });
    if (!res.ok) throw new Error(`${res.status}`);
    return URL.createObjectURL(await res.blob());
  },
  reextractAttachment: (id: string) => api<AttachmentRecord>(P(`/api/attachments/${id}/extract`), { method: "POST", body: "{}" }),
  settings: () => api<{ gemini: { configured: boolean; model: string } }>(P("/api/settings")),
  setGemini: (body: { apiKey?: string | null; model?: string }) =>
    api<{ gemini: { configured: boolean; model: string } }>(P("/api/settings/gemini"), { method: "PUT", body: JSON.stringify(body) }),
  /** ADR-0018: null when the adapter has no catalog (free text then). */
  adapterModels: (id: string) => api<{ models: ModelOption[] | null }>(P(`/api/adapters/${encodeURIComponent(id)}/models`)),
  adapterUsage: (id: string) => api<AdapterUsage>(P(`/api/adapters/${id}/usage`)),
  projects: () => api<ProjectDiscoveryResult>(P("/api/projects")),
  skills: (project: string) => api<{ items: SkillOrAgent[] }>(P(`/api/skills?project=${encodeURIComponent(project)}`)),
  recommendPrompt: (project: string, text: string) =>
    api<PromptRecommendation | null>(P("/api/prompt-recommendation"), { method: "POST", body: JSON.stringify({ project, text }) }),
  saveArtifact: (body: { project: string; kind: PromptRecommendation["kind"]; name: string; description: string; draft: string }) =>
    api<{ path: string }>(P("/api/skills"), { method: "POST", body: JSON.stringify(body) }),
  enhancePrompt: (adapter: string, project: string, text: string) =>
    api<EnhanceResult>(P("/api/prompt-enhance"), { method: "POST", body: JSON.stringify({ adapter, project, text }) }),
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
  }) => api<{ ok: boolean }>(P("/api/prompt-optimizer/feedback"), { method: "POST", body: JSON.stringify(entry) }),
  sessions: () => api<SessionRecord[]>(P("/api/sessions")),
  session: (id: string) => api<SessionRecord>(P(`/api/sessions/${id}`)),
  discovery: (cursor = 0, limit = 50) => api<DiscoveryPage>(P(`/api/discovery?cursor=${cursor}&limit=${limit}`)),
  inventory: () => api<{ items: HarnessInventoryEntry[] }>(P("/api/inventory")),
  fleet: () => api<FleetOverview>(P("/api/fleet")),
  fleetHello: () => api<{ hostId: string; protocolVersion: number }>(P("/api/fleet/hello")),
  fleetInvite: () => api<{ code: string; expiresAt: string }>(P("/api/fleet/invites"), { method: "POST", body: "{}" }),
  fleetPeers: () => api<FleetPeer[]>(P("/api/fleet/peers")),
  fleetAddPeer: (url: string, code: string) =>
    api<FleetPeer>(P("/api/fleet/peers"), { method: "POST", body: JSON.stringify({ url, code }) }),
  // Body "{}": Fastify rejects an empty body with a JSON content type (BUG-0011).
  fleetRemovePeer: (hostId: string) =>
    api<{ ok: boolean }>(P(`/api/fleet/peers/${encodeURIComponent(hostId)}`), { method: "DELETE", body: "{}" }),
  notifications: (after = 0) => api<{ items: HubNotification[]; lastId: number }>(P(`/api/notifications?after=${after}`)),
  sessionDiff: (id: string) => api<SessionDiffResult>(P(`/api/sessions/${id}/diff`)),
  /** T3.8: real qmd-backed project search. A 501 (qmd not installed on
   * this host) is a real, expected state for a fresh/minimal deployment —
   * callers show it as "Suche nicht verfügbar", not a hard error. */
  searchStatus: (project: string) => api<SearchStatus>(P(`/api/search/status?project=${encodeURIComponent(project)}`)),
  search: (project: string, q: string) =>
    api<SearchResponse>(P(`/api/search?project=${encodeURIComponent(project)}&q=${encodeURIComponent(q)}`)),
  searchFile: (project: string, path: string) =>
    api<ProjectFile>(P(`/api/search/file?project=${encodeURIComponent(project)}&path=${encodeURIComponent(path)}`)),
  /** T2.4/T2.6: the approval queue. 501 (approvals not configured on this
   * hub) is treated as "no queue" by callers, not a hard error — see
   * Approvals.tsx. */
  approvals: (status?: ApprovalStatus) =>
    api<ApprovalRequest[]>(P(`/api/approvals${status ? `?status=${status}` : ""}`)),
  /** T2.7: request a higher budget for a parked-for-budget session.
   * Applied immediately (200) if this hub has no approvals configured,
   * otherwise parked pending a write-class approval (422, same
   * ack.ok===false shape as /steer). */
  requestBudgetTopUp: (id: string, budgetUsd: number, reason?: string) =>
    api<{ ok: boolean; detail?: string }>(P(`/api/sessions/${id}/budget`), {
      method: "POST",
      body: JSON.stringify({ budgetUsd, ...(reason ? { reason } : {}) }),
    }),
  decideApproval: (id: string, decision: "approve" | "reject", reason?: string, answers?: Record<string, string>) =>
    api<ApprovalRequest>(P(`/api/approvals/${id}/decide`), {
      method: "POST",
      body: JSON.stringify({ decision, ...(reason ? { reason } : {}), ...(answers ? { answers } : {}) }),
    }),
  /** T2.5: WebAuthn passkey registration + the biometric decide path for
   * `destructive` approvals. 501 (webauthn not configured) is a real,
   * common state — same "feature genuinely absent" handling as the
   * approval queue's own 501. */
  webauthnStatus: () => api<{ registered: boolean }>(P("/api/webauthn/status")),
  // Fastify's JSON body parser rejects a POST with the JSON content-type
  // header (set unconditionally by api() below) but a truly empty body —
  // real bug found live-testing this against the actual server — so
  // these two no-payload POSTs send an explicit empty object instead.
  webauthnRegisterOptions: () => api<unknown>(P("/api/webauthn/register/options"), { method: "POST", body: "{}" }),
  webauthnRegisterVerify: (response: unknown) =>
    api<{ ok: boolean }>(P("/api/webauthn/register/verify"), { method: "POST", body: JSON.stringify(response) }),
  webauthnAssertOptions: (approvalId: string) =>
    api<unknown>(P(`/api/approvals/${approvalId}/webauthn/assert-options`), { method: "POST", body: "{}" }),
  decideApprovalBiometric: (approvalId: string, decision: "approve" | "reject", response: unknown, reason?: string) =>
    api<ApprovalRequest>(P(`/api/approvals/${approvalId}/webauthn/decide`), {
      method: "POST",
      body: JSON.stringify({ decision, response, ...(reason ? { reason } : {}) }),
    }),
  /** T2.2 expand-on-tap: full hunks for one file, after /diff collapsed them under K3. */
  /** T7.6: local code search and viewer in the session's worktree. */
  codeSearch: (sessionId: string, q: string, mode: "text" | "symbol") =>
    api<CodeSearchResult>(P(`/api/code/search?session=${encodeURIComponent(sessionId)}&q=${encodeURIComponent(q)}&mode=${mode}`)),
  codeFile: (sessionId: string, path: string) =>
    api<CodeFile>(P(`/api/code/file?session=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`)),
  sessionActions: (sessionId: string) => api<{ actions: ActionDefinition[]; runs: ActionRun[] }>(P(`/api/sessions/${sessionId}/actions`)),
  runAction: (sessionId: string, actionId: string, params: Record<string, string>) =>
    api<ActionRun>(P(`/api/sessions/${sessionId}/actions/${encodeURIComponent(actionId)}`), { method: "POST", body: JSON.stringify({ params }) }),
  actionRun: (sessionId: string, runId: string) => api<ActionRun>(P(`/api/sessions/${sessionId}/actions/runs/${runId}`)),
  sessionDiffHunk: (id: string, path: string) =>
    api<{ path: string; hunks: DiffHunk[] }>(P(`/api/sessions/${id}/diff/hunk?path=${encodeURIComponent(path)}`)),
  events: (id: string, afterSeq = 0, limit = 500) =>
    api<{ seq: number; type: string; summary: string; ts: string; payload: unknown; blobRef: string | null }[]>(
      P(`/api/sessions/${id}/events?afterSeq=${afterSeq}&limit=${limit}`),
    ),
  createSession: (body: {
    adapter: string;
    project: string;
    prompt?: string;
    model?: string;
    budgetUsd?: number | null;
    args?: { skill?: string; agent?: string };
    attachmentIds?: string[];
  }) =>
    api<SessionRecord>(P("/api/sessions"), {
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
  /** Commit the session worktree and merge it into the project checkout. */
  applyToProject: async (id: string): Promise<{ ok: boolean; into?: string; commit?: string; files?: number; detail?: string }> => {
    const res = await fetch(P(`/api/sessions/${id}/apply`), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${getToken()}` },
      body: "{}",
    });
    return (await res.json().catch(() => ({ ok: false, detail: `${res.status} ${res.statusText}` }))) as {
      ok: boolean;
      into?: string;
      commit?: string;
      files?: number;
      detail?: string;
    };
  },
  stopSession: (id: string) =>
    api<{ ok: boolean }>(P(`/api/sessions/${id}/stop`), { method: "POST", body: "{}" }),
  /** T8.6: rename and pin. */
  setSessionMeta: (id: string, meta: { title?: string | null; pinned?: boolean }) =>
    api<SessionRecord>(P(`/api/sessions/${id}/meta`), { method: "POST", body: JSON.stringify(meta) }),
  setArchived: (id: string, archived: boolean) =>
    api<SessionRecord>(P(`/api/sessions/${id}/archive`), {
      method: "POST",
      body: JSON.stringify({ archived }),
    }),
  // T1.5-6: doesn't go through api<T>() — a rejected steer (e.g. "no
  // thread_id captured yet") comes back as a 422 with a real, meaningful
  // {ok:false, detail} body, and api<T>()'s generic !res.ok path would
  // throw a bare "422 Unprocessable Entity" instead of surfacing that
  // detail. Callers inspect ack.ok/ack.detail themselves.
  /** `takeover` moves the writer lease to this device on purpose (T5.5). */
  /** T10.2 (ADR-0028): local speech-to-text on the hub. */
  stt: () => api<{ available: boolean; engine?: string }>(P("/api/stt")),
  transcribe: async (audio: Blob): Promise<{ text: string; engine: string; audioMs: number; latencyMs: number }> => {
    const res = await fetch(P("/api/stt"), { method: "POST", headers: { "content-type": audio.type || "audio/webm", authorization: `Bearer ${getToken()}` }, body: audio });
    const body = (await res.json().catch(() => ({}))) as { text?: string; engine?: string; audioMs?: number; latencyMs?: number; error?: string };
    if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
    return { text: body.text ?? "", engine: body.engine ?? "", audioMs: body.audioMs ?? 0, latencyMs: body.latencyMs ?? 0 };
  },
  /** T9 (ADR-0027): text in, a plan out; executed through the real routes. */
  commandPlan: (text: string, context: Record<string, unknown>, answers?: Record<string, string>) =>
    api<CommandPlan>(P("/api/commands/plan"), { method: "POST", body: JSON.stringify({ text, context, ...(answers ? { answers } : {}) }) }),
  commandExecute: (id: string, context: Record<string, unknown>) =>
    api<{ planId: string; results: StepResult[]; repeated: boolean }>(P(`/api/commands/${id}/execute`), { method: "POST", body: JSON.stringify({ context }) }),
  commandTransform: (text: string, transform: string) =>
    api<{ text: string; model: string; provider: string; latencyMs: number }>(P("/api/commands/transform"), { method: "POST", body: JSON.stringify({ text, transform }) }),
  /** T8.3 (ADR-0026): Web Push. */
  push: () => api<PushState>(P("/api/push")),
  setPushEnabled: (enabled: boolean) => api<{ enabled: boolean; publicKey: string | null }>(P("/api/push/enabled"), { method: "PUT", body: JSON.stringify({ enabled }) }),
  pushSubscribe: (body: { endpoint: string; keys: { p256dh: string; auth: string }; oldEndpoint?: string; quiet?: { from: number; to: number; tzOffsetMinutes: number } | null; done?: boolean }) =>
    api<{ ok: boolean }>(P("/api/push/subscriptions"), { method: "POST", body: JSON.stringify(body) }),
  pushUnsubscribe: (endpoint: string) => api<{ ok: boolean }>(P("/api/push/subscriptions"), { method: "DELETE", body: JSON.stringify({ endpoint }) }),
  pushTest: () => api<{ sent: number; errors: string[] }>(P("/api/push/test"), { method: "POST", body: "{}" }),
  /** T8.4 (ADR-0025): the shared draft of a session. */
  draft: (id: string) => api<SessionDraft>(P(`/api/sessions/${id}/draft`)),
  saveDraft: async (id: string, text: string, attachmentIds: string[], baseRevision: number): Promise<{ ok: true; draft: SessionDraft } | { ok: false; current: SessionDraft }> => {
    const res = await fetch(P(`/api/sessions/${id}/draft`), {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ text, attachmentIds, baseRevision }),
    });
    const body = (await res.json().catch(() => ({}))) as SessionDraft & { current?: SessionDraft; error?: string };
    if (res.status === 409 && body.current) return { ok: false, current: body.current };
    if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
    return { ok: true, draft: body };
  },
  steer: async (id: string, input: SteerInput, inputId?: string, takeover = false): Promise<Ack> => {
    const res = await fetch(P(`/api/sessions/${id}/steer`), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ ...input, clientId: clientId(), ...(inputId ? { inputId } : {}), ...(takeover ? { takeover } : {}) }),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; detail?: string; error?: string };
    // Two possible failure shapes from the server: a rejected Ack
    // ({ok:false, detail}) or a validation error ({error}, e.g. empty
    // text) — normalize both into one Ack so callers only check one thing.
    if (typeof body.ok === "boolean") return { ok: body.ok, ...(body.detail ? { detail: body.detail } : {}) };
    return { ok: false, detail: body.error ?? `${res.status} ${res.statusText}` };
  },
  };
}

export type HubApi = ReturnType<typeof createHubApi>;

/** This hub. */
export const hubApi: HubApi = createHubApi((path) => path);

let selfHostId: string | null = null;

/** Learned once from /api/fleet/hello: which host id is this hub. */
export function setSelfHostId(hostId: string | null): void {
  selfHostId = hostId;
}

/** The host id if it is another hub of the fleet, else null (this hub). */
export function remoteHost(hostId: string | null | undefined): string | null {
  return hostId && hostId !== selfHostId ? hostId : null;
}

/**
 * EPIC-P6: the same calls for one host of the fleet — through this hub's
 * /api/hosts/<hostId>/… route (answered locally for its own id).
 */
export function hostApi(hostId: string | null | undefined): HubApi {
  const remote = remoteHost(hostId);
  if (!remote) return hubApi;
  return createHubApi((path) => (path.startsWith("/api/") ? `/api/hosts/${encodeURIComponent(remote)}/${path.slice(5)}` : path));
}
