import { readFile } from "node:fs/promises";

/** ADR-0094 (EPIC-P73): Issue-Sicht des REST-Clients — nur was die Bridge braucht. */
export interface IssueView {
  number: number;
  title: string;
  body: string | null;
  labels: string[];
  url: string;
  updatedAt: string;
}

/** Letzter Run je Workflow — Grundlage der ExternalJobInfo-Anzeige (kein Log-Dump). */
export interface WorkflowRunView {
  workflow: string;
  runName: string;
  status: string;
  conclusion: string | null;
  event: string;
  url: string;
  atUtc: string;
}

export interface GitHubClientDeps {
  fetch?: typeof fetch;
  readFile?: (path: string) => Promise<string>;
  /** Tests/E2E: lokaler Stub-Server statt api.github.com. */
  baseUrl?: string;
}

/** ADR-0094: Der GitHub-Token liegt neben der GitLab-Forge-Verknüpfung
 * (ADR-0056) — issues.tokenFile gewinnt, sonst forge.github.tokenFile.
 * Ohne Token gibt es keine GitHub-Verbindung (fail loud beim Start). */
export function resolveGitHubTokenFile(
  issues: { tokenFile?: string | undefined } | undefined,
  forge: { github?: { tokenFile?: string | undefined } | undefined } | undefined,
): string | null {
  return issues?.tokenFile ?? forge?.github?.tokenFile ?? null;
}

/**
 * ADR-0094: dünner GitHub-REST-Client (fetch, token aus Datei — nie aus der
 * Config). Kein SDK, kein Cache: die Bridge pollt outbound, der TTL-Cache für
 * die Anzeige liegt beim Aufrufer (K10-Muster ForgeService).
 */
export class GitHubClient {
  private readonly repo: string;
  private readonly tokenFile: string;
  private readonly deps: Required<GitHubClientDeps>;

  constructor(repo: string, tokenFile: string, deps: GitHubClientDeps = {}) {
    if (!/^[^\s/]+\/[^\s/]+$/.test(repo)) throw new Error(`repo muss owner/name sein, nicht: ${repo}`);
    this.repo = repo;
    this.tokenFile = tokenFile;
    this.deps = { fetch: fetch, readFile: (p) => readFile(p, "utf8"), baseUrl: "https://api.github.com", ...deps };
  }

  private async token(): Promise<string> {
    const first = (await this.deps.readFile(this.tokenFile)).split("\n", 2)[0] ?? "";
    const trimmed = first.trim();
    if (!trimmed) throw new Error(`Token-Datei ${this.tokenFile} ist leer`);
    return trimmed;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await this.token();
    const res = await this.deps.fetch(`${this.deps.baseUrl}${path}`, {
      ...init,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
        "user-agent": "ancientvoid-issue-bridge",
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) throw new Error(`GitHub ${path} → HTTP ${res.status} ${res.statusText}`.trim());
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  }

  /** Offene Issues mit Label, geändert seit `sinceIso` (ISO). Die Issues-API
   * liefert auch PRs — die gefiltert, sonst startet ein gelabelter PR eine Session. */
  async listLabeledIssues(label: string, sinceIso: string): Promise<IssueView[]> {
    const raw = await this.request<Array<Record<string, unknown>>>(
      `/repos/${this.repo}/issues?state=open&labels=${encodeURIComponent(label)}&since=${encodeURIComponent(sinceIso)}&sort=updated&direction=desc&per_page=100`,
    );
    return raw
      .filter((i) => !("pull_request" in i))
      .map((i) => ({
        number: i.number as number,
        title: String(i.title ?? ""),
        body: (i.body as string | null) ?? null,
        labels: Array.isArray(i.labels) ? i.labels.map((l) => String((l as { name?: string }).name ?? "")) : [],
        url: String(i.html_url ?? ""),
        updatedAt: String(i.updated_at ?? ""),
      }));
  }

  async createComment(issueNumber: number, body: string): Promise<string> {
    const created = await this.request<{ html_url?: string }>(`/repos/${this.repo}/issues/${issueNumber}/comments`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
    return String(created.html_url ?? "");
  }

  async listLatestWorkflowRuns(): Promise<WorkflowRunView[]> {
    const raw = await this.request<{ workflow_runs?: Array<Record<string, unknown>> }>(`/repos/${this.repo}/actions/runs?per_page=100`);
    const latest = new Map<string, WorkflowRunView>();
    for (const r of raw.workflow_runs ?? []) {
      const workflow = String(r.name ?? "");
      if (!workflow || latest.has(workflow)) continue; // API liefert neueste zuerst
      latest.set(workflow, {
        workflow,
        runName: String(r.display_title ?? workflow),
        status: String(r.status ?? "unknown"),
        conclusion: (r.conclusion as string | null) ?? null,
        event: String(r.event ?? ""),
        url: String(r.html_url ?? ""),
        atUtc: String(r.run_started_at ?? r.created_at ?? ""),
      });
    }
    return [...latest.values()];
  }
}
