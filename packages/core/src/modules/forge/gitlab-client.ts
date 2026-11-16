import { execFile } from "node:child_process";
import { promisify } from "node:util";

/**
 * EPIC-P37 / ADR-0056 §3: GitLab-Zugang über `glab api` als argv-Kindprozess.
 * Reine Argument-Übergabe an execFile (BUG-0013-Lektion: nie interpolieren,
 * nie Shell). Der Runner ist injizierbar — Tests und E2E setzen einen Stub.
 */

const execFileAsync = promisify(execFile);

export interface GlabRunResult {
  stdout: string;
  stderr: string;
}

export type GlabRunner = (argv: string[], opts?: { timeoutMs?: number }) => Promise<GlabRunResult>;

export type GlabErrorKind = "auth" | "rate_limit" | "network" | "http" | "parse" | "missing";

export class GitLabApiError extends Error {
  readonly kind: GlabErrorKind;
  readonly path: string;
  readonly status: number | null;
  constructor(kind: GlabErrorKind, path: string, message: string, status: number | null = null) {
    super(message);
    this.kind = kind;
    this.path = path;
    this.status = status;
  }
}

/** Produktions-Runner: das konfigurierte glab-Binary (E2E: Stub-Pfad). */
export function createGlabRunner(command: string, env: () => Record<string, string> = () => ({})): GlabRunner {
  return async (argv, opts) => {
    try {
      const { stdout, stderr } = await execFileAsync(command, ["api", ...argv], {
        timeout: opts?.timeoutMs ?? 15_000,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, ...env() },
      });
      return { stdout, stderr };
    } catch (err) {
      const e = err as { code?: string | number; stdout?: string; stderr?: string; killed?: boolean; message?: string };
      const stderr = e.stderr ?? e.message ?? "";
      const stdout = e.stdout ?? "";
      throw classify(argv.join(" "), stderr, e.code, stdout);
    }
  };
}

/** Fehlerklasse aus glab-Exit bestimmen — sichtbar, nie still (ADR §5). */
export function classify(path: string, stderr: string, code: string | number | undefined, stdout: string): GitLabApiError {
  const text = `${stderr}`.toLowerCase();
  if (/\b401\b|\b403\b|unauthorized|forbidden|not authenticated/.test(text)) {
    return new GitLabApiError("auth", path, `GitLab-Zugang abgelehnt (401/403): ${stderr.trim().slice(0, 300)}`, 401);
  }
  if (/\b429\b|rate limit|too many requests/.test(text)) {
    return new GitLabApiError("rate_limit", path, `GitLab-Rate-Limit erreicht: ${stderr.trim().slice(0, 300)}`, 429);
  }
  if (
    /connection refused|dial tcp|no such host|network is unreachable|timeout|i\/o timeout|tls handshake/.test(text) ||
    code === "ENOTFOUND" ||
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT"
  ) {
    return new GitLabApiError("network", path, `GitLab nicht erreichbar: ${stderr.trim().slice(0, 300)}`);
  }
  if (/not found|404/.test(text)) {
    return new GitLabApiError("http", path, `GitLab meldet nicht gefunden (404): ${stderr.trim().slice(0, 200)}`, 404);
  }
  if (stdout.trim().length === 0 && /spawn|enoent|no such file/.test(text)) {
    return new GitLabApiError("missing", path, `glab nicht gefunden (${stderr.trim().slice(0, 200)})`);
  }
  return new GitLabApiError("http", path, `glab api fehlgeschlagen: ${stderr.trim().slice(0, 300)}`);
}

/** GET eines API-Pfades als JSON — Pfad inkl. Query, alles als Argument. */
export async function glabApiJson<T>(run: GlabRunner, path: string, opts?: { timeoutMs?: number }): Promise<T> {
  const res = await run([path], opts);
  try {
    return JSON.parse(res.stdout) as T;
  } catch {
    throw new GitLabApiError("parse", path, `Antwort war kein JSON (Anfang: ${res.stdout.slice(0, 120)})`);
  }
}

export interface PagedResult<T> {
  items: T[];
  /** true, wenn das Seitenlimit griff — sichtbar, kein stiller Verlust. */
  truncated: boolean;
}

/**
 * Alle Seiten eines Listendpunktes laden (ADR §5): explizite Pages, Ende bei
 * untervollem Blatt; harte Obergrenze mit `truncated` statt Endlosschleife.
 */
export async function fetchAllPages<T>(
  run: GlabRunner,
  basePath: string,
  args: { perPage?: number; maxPages?: number; extraQuery?: Record<string, string> } = {},
): Promise<PagedResult<T>> {
  const perPage = args.perPage ?? 100;
  const maxPages = args.maxPages ?? 10;
  const extra = Object.entries(args.extraQuery ?? {})
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  const items: T[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const query = `per_page=${perPage}&page=${page}${extra ? `&${extra}` : ""}`;
    const batch = await glabApiJson<T[]>(run, `${basePath}${basePath.includes("?") ? "&" : "?"}${query}`);
    if (!Array.isArray(batch)) throw new GitLabApiError("parse", basePath, "Listenantwort war kein Array");
    items.push(...batch);
    if (batch.length < perPage) return { items, truncated: false };
  }
  return { items, truncated: true };
}

/** GET eines API-Pfades als Text (Job-Traces). */
export async function glabApiText(run: GlabRunner, path: string, opts?: { timeoutMs?: number }): Promise<string> {
  const res = await run([path], opts);
  return res.stdout;
}
