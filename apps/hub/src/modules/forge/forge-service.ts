import { homedir } from "node:os";
import { resolve } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  createGlabRunner,
  ForgeStore,
  type GlabRunner,
} from "@ancientvoid/core";
import type { ForgeTraceView } from "@ancientvoid/contracts";
import { FORGE_TRACE_MAX_BYTES, FORGE_TRACE_PREVIEW_CHARS } from "@ancientvoid/contracts";

/**
 * EPIC-P37 / ADR-0056 §6: Hub-seitiger Forge-Dienst — Runner aus der Config
 * (E2E: Stub-Binary), Journal-Store und ein ehrlicher Cache: Bei Fehlern
 * kommt die letzte gute Antwort MIT Zeitstempel und Fehlerklasse zurück;
 * ein Cache beweist niemals aktuellen CI-Erfolg (K10).
 */

export interface ForgeCacheEntry<T> {
  data: T;
  fetchedAt: string;
  /** gesetzt, wenn dieser Wert aus dem Cache stammt und der Frischversuch fehlschlug */
  staleError: string | null;
}

const CACHE_TTL_MS = 30_000;

export class ForgeService {
  readonly store: ForgeStore;
  private readonly runner: GlabRunner;
  private readonly traceRoot: string;
  private readonly cache = new Map<string, { at: number; data: unknown }>();
  private readonly cacheTtlMs: number;

  constructor(args: { dataRoot: string; command: string; host?: string; tokenFile?: string; cacheTtlMs?: number }) {
    this.store = new ForgeStore(resolve(args.dataRoot, "forge"));
    this.traceRoot = resolve(args.dataRoot, "forge");
    let token: string | null = null;
    if (args.tokenFile) {
      const path = resolve(args.tokenFile.replace(/^~(?=\/)/, homedir()));
      try {
        token = readFileSync(path, "utf8").split("\n")[0]?.trim() || null;
      } catch (err) {
        // Fail loud: ein konfiguriertes, unlesbares Token ist kein stiller Offline-Fall
        throw new Error(`forge.gitlab.tokenFile nicht lesbar (${path}): ${err instanceof Error ? err.message : String(err)}`, { cause: err });
      }
    }
    this.cacheTtlMs = args.cacheTtlMs ?? CACHE_TTL_MS;
    this.runner = createGlabRunner(args.command, () => ({
      ...(args.host ? { GITLAB_HOST: args.host } : {}),
      ...(token ? { GITLAB_TOKEN: token } : {}),
    }));
  }

  /** GET mit TTL-Cache; bei Fehler zuletzt gute Daten + Fehlerklasse (K10). */
  async cached<T>(key: string, fetcher: () => Promise<T>): Promise<ForgeCacheEntry<T>> {
    const hit = this.cache.get(key);
    const now = Date.now();
    if (hit && now - hit.at < this.cacheTtlMs) {
      return { data: hit.data as T, fetchedAt: new Date(hit.at).toISOString(), staleError: null };
    }
    try {
      const data = await fetcher();
      this.cache.set(key, { at: now, data });
      return { data, fetchedAt: new Date(now).toISOString(), staleError: null };
    } catch (err) {
      if (hit) {
        return {
          data: hit.data as T,
          fetchedAt: new Date(hit.at).toISOString(),
          staleError: err instanceof Error ? err.message : "GitLab-Abruf fehlgeschlagen",
        };
      }
      throw err;
    }
  }

  invalidate(prefix: string): void {
    for (const key of [...this.cache.keys()]) if (key.startsWith(prefix)) this.cache.delete(key);
  }

  get run(): GlabRunner {
    return this.runner;
  }

  /** Trace-Vorschau (gekapter Schwanz) + vollständige Datei unter dataDir (ADR §10). */
  async traceView(args: { sessionId: string; jobId: number; pipelineId: number | null; sha: string | null; fetch: () => Promise<string> }): Promise<ForgeTraceView> {
    const raw = await args.fetch();
    const buffer = Buffer.from(raw, "utf8");
    const truncated = buffer.byteLength > FORGE_TRACE_MAX_BYTES;
    const capped = truncated ? buffer.subarray(buffer.byteLength - FORGE_TRACE_MAX_BYTES) : buffer;
    const dir = resolve(this.traceRoot, args.sessionId, "traces");
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, `${args.jobId}.log`), capped);
    const text = capped.toString("utf8");
    const preview = text.length > FORGE_TRACE_PREVIEW_CHARS ? `… ${text.slice(text.length - FORGE_TRACE_PREVIEW_CHARS)}` : text;
    return {
      jobId: args.jobId,
      pipelineId: args.pipelineId,
      sha: args.sha,
      fetchedAt: new Date().toISOString(),
      sizeBytes: buffer.byteLength,
      truncated,
      preview,
    };
  }
}
