import {
  FORGE_PIPELINE_STATUSES,
  type ForgeHost,
  type ForgeIssueSummary,
  type ForgeJobSummary,
  type ForgeMrRef,
  type ForgeMrSummary,
  type ForgePipelineStatus,
  type ForgePipelineSummary,
  type ForgeThread,
  type ForgeThreadNote,
} from "@ancientvoid/contracts";
import { fetchAllPages, glabApiJson, glabApiText, type GlabRunner } from "./gitlab-client.ts";

/**
 * EPIC-P37 / ADR-0056 §5: GitLab-Reader. Reine Abbildung von API-JSON auf
 * Contract-Typen plus paginierte Lesezugriffe. Fremdtexte (Beschreibungen,
 * Kommentare, Job-Namen) werden gekappt übernommen — sie sind zitierte
 * Daten, keine Anweisungen (PRD §8.5).
 */

const NOTE_BODY_MAX_CHARS = 4_000;
const TITLE_MAX_CHARS = 300;

type Raw = Record<string, unknown>;

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const num = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const nullableStr = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

const asStatus = (v: unknown): ForgePipelineStatus => {
  const s = str(v);
  return (FORGE_PIPELINE_STATUSES as readonly string[]).includes(s) ? (s as ForgePipelineStatus) : "created";
};

export function encodeProjectId(ref: { projectId: number; projectPath?: string | undefined }): string {
  // Numerische ID bevorzugt (stabiler); Pfade URL-kodiert mit %2F als Fallback
  return ref.projectId > 0 ? String(ref.projectId) : encodeURIComponent(ref.projectPath ?? "");
}

const username = (v: unknown): string => (typeof v === "object" && v !== null ? str((v as Raw).username) : "");

/** Projekt-Pfad oder -ID → kanonische Projekt-Identität über die API. */
export async function resolveProject(run: GlabRunner, pathOrId: string): Promise<{ projectId: number; projectPath: string; webUrl: string }> {
  // Pfade bleiben URL-kodiert (%2F) — GitLab API v4 verlangt das für Path-IDs
  const raw = await glabApiJson<Raw>(run, `projects/${encodeURIComponent(pathOrId)}`);
  const path = str(raw.path_with_namespace);
  if (!path) throw new Error("Projektantwort ohne path_with_namespace");
  return { projectId: num(raw.id), projectPath: path, webUrl: str(raw.web_url) };
}

export function mapMr(ref: ForgeMrRef, raw: Raw): ForgeMrSummary {
  // references.full ist "<projektpfad>!<iid>" — füllt projectPath, falls nur die ID bekannt war
  const full = str((raw.references as Raw | undefined)?.full);
  const derivedPath = full.includes("!") ? full.slice(0, full.lastIndexOf("!")) : "";
  const enriched: ForgeMrRef = {
    host: ref.host,
    projectId: ref.projectId,
    mrIid: ref.mrIid,
    ...(ref.projectPath ?? derivedPath ? { projectPath: ref.projectPath ?? derivedPath } : {}),
  };
  return {
    ref: enriched,
    title: str(raw.title).slice(0, TITLE_MAX_CHARS),
    state: (["opened", "closed", "merged", "locked"] as const).includes(str(raw.state) as never) ? (str(raw.state) as ForgeMrSummary["state"]) : "opened",
    draft: raw.draft === true || /draft/i.test(str(raw.title).slice(0, 8)),
    sourceBranch: str(raw.source_branch),
    targetBranch: str(raw.target_branch),
    sha: nullableStr(raw.sha),
    webUrl: str(raw.web_url),
    author: username(raw.author),
    updatedAt: nullableStr(raw.updated_at),
  };
}

export async function fetchMr(run: GlabRunner, ref: ForgeMrRef): Promise<ForgeMrSummary> {
  const raw = await glabApiJson<Raw>(run, `projects/${encodeProjectId(ref)}/merge_requests/${ref.mrIid}`);
  return mapMr(ref, raw);
}

export function mapPipeline(raw: Raw): ForgePipelineSummary {
  return {
    id: num(raw.id),
    iid: typeof raw.iid === "number" ? raw.iid : null,
    status: asStatus(raw.status),
    sha: nullableStr(raw.sha),
    ref: str(raw.ref),
    webUrl: str(raw.web_url),
    createdAt: nullableStr(raw.created_at),
  };
}

/** Pipelines zum MR-Branch (und SHA, wenn bekannt — jüngste zuerst). */
export async function fetchPipelines(run: GlabRunner, ref: ForgeMrRef, sourceBranch: string): Promise<ForgePipelineSummary[]> {
  const { items, truncated } = await fetchAllPages<Raw>(run, `projects/${encodeProjectId(ref)}/pipelines`, {
    extraQuery: { ref: sourceBranch },
    perPage: 20,
    maxPages: 2,
  });
  const mapped = items.map(mapPipeline);
  // jüngste zuerst (GitLab liefert bereits absteigend — defensive Sortierung)
  mapped.sort((a, b) => (b.id > a.id ? 1 : b.id < a.id ? -1 : 0));
  return truncated ? mapped.slice(0, 40) : mapped;
}

export function mapJob(raw: Raw): ForgeJobSummary {
  return {
    id: num(raw.id),
    name: str(raw.name).slice(0, 200),
    status: asStatus(raw.status),
    stage: str(raw.stage).slice(0, 120),
    kind: "job",
    downstreamPipelineId: null,
    allowFailure: raw.allow_failure === true,
    webUrl: str(raw.web_url),
  };
}

/** Bridge-Jobs (Trigger für Child-Pipelines) — ihre Fehler dürfen nicht verschwinden (AC-P37-2). */
export function mapBridge(raw: Raw): ForgeJobSummary {
  return {
    id: num(raw.id),
    name: str(raw.name).slice(0, 200),
    status: asStatus(raw.status),
    stage: str(raw.stage).slice(0, 120),
    kind: "bridge",
    downstreamPipelineId: typeof raw.downstream_pipeline === "object" && raw.downstream_pipeline !== null ? num((raw.downstream_pipeline as Raw).id) || null : null,
    allowFailure: raw.allow_failure === true,
    webUrl: str(raw.web_url),
  };
}

export async function fetchJobs(run: GlabRunner, ref: ForgeMrRef, pipelineId: number): Promise<ForgeJobSummary[]> {
  const base = `projects/${encodeProjectId(ref)}/pipelines/${pipelineId}`;
  const [jobs, bridges] = await Promise.all([
    fetchAllPages<Raw>(run, `${base}/jobs`, { perPage: 100, maxPages: 2 }),
    fetchAllPages<Raw>(run, `${base}/bridges`, { perPage: 100, maxPages: 2 }),
  ]);
  return [...jobs.items.map(mapJob), ...bridges.items.map(mapBridge)];
}

export function mapThread(raw: Raw): ForgeThread {
  const notesRaw = Array.isArray(raw.notes) ? (raw.notes as Raw[]) : [];
  const notes: ForgeThreadNote[] = notesRaw.slice(0, 50).map((n) => ({
    author: username(n.author),
    body: str(n.body).slice(0, NOTE_BODY_MAX_CHARS),
    system: n.system === true,
    createdAt: nullableStr(n.created_at),
  }));
  return {
    id: str(raw.id),
    resolved: !notesRaw.some((n) => n.resolvable === true) || notesRaw.some((n) => n.resolved === true),
    notes,
  };
}

export async function fetchThreads(run: GlabRunner, ref: ForgeMrRef): Promise<{ items: ForgeThread[]; truncated: boolean }> {
  const res = await fetchAllPages<Raw>(run, `projects/${encodeProjectId(ref)}/merge_requests/${ref.mrIid}/discussions`, {
    perPage: 100,
    maxPages: 5,
  });
  return { items: res.items.map(mapThread).filter((t) => t.notes.length > 0), truncated: res.truncated };
}

export function mapIssue(host: ForgeHost, projectId: number, raw: Raw): ForgeIssueSummary {
  return {
    host,
    projectId,
    iid: num(raw.iid),
    title: str(raw.title).slice(0, TITLE_MAX_CHARS),
    description: str(raw.description).slice(0, 8_000),
    state: str(raw.state) === "closed" ? "closed" : "opened",
    author: username(raw.author),
    webUrl: str(raw.web_url),
    labels: (Array.isArray(raw.labels) ? raw.labels : []).filter((l): l is string => typeof l === "string").slice(0, 30),
  };
}

export async function fetchIssues(run: GlabRunner, host: ForgeHost, projectId: number, projectPath?: string | undefined): Promise<{ items: ForgeIssueSummary[]; truncated: boolean }> {
  const res = await fetchAllPages<Raw>(run, `projects/${encodeProjectId({ projectId, projectPath })}/issues`, {
    extraQuery: { state: "opened", order_by: "updated_at" },
    perPage: 50,
    maxPages: 2,
  });
  return { items: res.items.map((r) => mapIssue(host, projectId, r)), truncated: res.truncated };
}

/** Job-Trace als Text (vollständig; Kappung macht der Aufrufer, ADR §10). */
export async function fetchTrace(run: GlabRunner, ref: ForgeMrRef, jobId: number): Promise<string> {
  return glabApiText(run, `projects/${encodeProjectId(ref)}/jobs/${jobId}/trace`);
}

/** Nach MRs mit Source-Branch suchen — Retry-Abgleich bei verlorener Antwort (AC-P37-5). */
export async function findMrsBySourceBranch(
  run: GlabRunner,
  ref: ForgeMrRef,
  sourceBranch: string,
): Promise<ForgeMrSummary[]> {
  const res = await fetchAllPages<Raw>(run, `projects/${encodeProjectId(ref)}/merge_requests`, {
    extraQuery: { source_branch: sourceBranch },
    perPage: 20,
    maxPages: 1,
  });
  return res.items.map((r) => mapMr(ref, r));
}
