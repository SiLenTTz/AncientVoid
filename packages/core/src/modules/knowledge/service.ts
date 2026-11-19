import { randomUUID } from "node:crypto";
import {
  KNOWLEDGE_MAX_SOURCES,
  KnowledgeSourceInput,
  type KnowledgeAuth,
  type KnowledgeOverview,
  type KnowledgeQuery,
  type KnowledgeReadResult,
  type KnowledgeSearchResult,
  type KnowledgeSourceInputRaw,
  type KnowledgeSourceView,
  type KnowledgeStatus,
  type KnowledgeTools,
} from "@ancientvoid/contracts";
import { KnowledgeError, createMcpKnowledgeSource } from "./mcp-source.ts";

type Settings = { get(key: string): string | null; set(key: string, value: string | null): void };

const SOURCES_KEY = "knowledge.sources";
/** Eigener Schlüssel je Quelle: die Liste (und jeder Export davon) trägt das Geheimnis nie. */
const secretKey = (id: string) => `knowledge.secret.${id}`;

interface StoredSource {
  id: string;
  label: string;
  url: string;
  auth: KnowledgeAuth;
  tools: KnowledgeTools;
  createdAt: string;
  status: KnowledgeStatus;
}

const UNKNOWN: KnowledgeStatus = { state: "unknown", at: null, detail: null, failures: 0 };

export type KnowledgeCall<T> = ({ ok: true } & T & { source: KnowledgeSourceView }) | { ok: false; error: string; source: KnowledgeSourceView };

/**
 * ADR-0096 (EPIC-P74 T74.6a): angebundene Wissensquellen. Persistenz in der
 * `config`-Tabelle (Backup/Recovery wie die Verbindungen, K7); der Status ist
 * abgeleitet — jeder Aufruf schreibt ihn neu, „Prüfen“ gewinnt ihn zurück.
 */
export class KnowledgeService {
  private readonly settings: Settings;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly timeoutMs: number | undefined;

  constructor(settings: Settings, opts: { fetch?: typeof fetch; timeoutMs?: number } = {}) {
    this.settings = settings;
    this.fetchImpl = opts.fetch;
    this.timeoutMs = opts.timeoutMs;
  }

  private readAll(): StoredSource[] {
    try {
      const raw = JSON.parse(this.settings.get(SOURCES_KEY) ?? "[]") as StoredSource[];
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  private write(all: StoredSource[]): void {
    this.settings.set(SOURCES_KEY, all.length ? JSON.stringify(all) : null);
  }

  private view(s: StoredSource): KnowledgeSourceView {
    return { id: s.id, label: s.label, url: s.url, auth: s.auth, hasSecret: this.settings.get(secretKey(s.id)) !== null, tools: s.tools, createdAt: s.createdAt, status: s.status };
  }

  private applySecret(id: string, auth: KnowledgeAuth, secret: string | null | undefined): void {
    if (auth.kind === "none" || secret === null) this.settings.set(secretKey(id), null);
    else if (secret !== undefined) this.settings.set(secretKey(id), secret);
  }

  list(): KnowledgeSourceView[] {
    return this.readAll().map((s) => this.view(s));
  }

  get(id: string): KnowledgeSourceView | null {
    const s = this.readAll().find((e) => e.id === id);
    return s ? this.view(s) : null;
  }

  /** null = Obergrenze erreicht. */
  add(raw: KnowledgeSourceInputRaw, now = () => new Date()): KnowledgeSourceView | null {
    const input = KnowledgeSourceInput.parse(raw);
    const all = this.readAll();
    if (all.length >= KNOWLEDGE_MAX_SOURCES) return null;
    const entry: StoredSource = { id: randomUUID(), label: input.label, url: input.url, auth: input.auth, tools: input.tools, createdAt: now().toISOString(), status: UNKNOWN };
    this.write([...all, entry]);
    this.applySecret(entry.id, input.auth, input.secret);
    return this.view(entry);
  }

  /** secret: undefined = unverändert, null = entfernen, String = ersetzen. */
  update(id: string, raw: KnowledgeSourceInputRaw): { source: KnowledgeSourceView } | { error: string } | null {
    const input = KnowledgeSourceInput.parse(raw);
    const all = this.readAll();
    const entry = all.find((e) => e.id === id);
    if (!entry) return null;
    const hasSecret = this.settings.get(secretKey(id)) !== null;
    if (hasSecret && input.secret === undefined && input.auth.kind !== "none" && new URL(input.url).origin !== new URL(entry.url).origin) {
      return { error: "Neue Adresse: Geheimnis neu eingeben oder entfernen — es geht nicht ungefragt an einen anderen Host." };
    }
    const changedTarget = entry.url !== input.url || JSON.stringify(entry.auth) !== JSON.stringify(input.auth) || input.secret !== undefined;
    Object.assign(entry, { label: input.label, url: input.url, auth: input.auth, tools: input.tools, ...(changedTarget ? { status: UNKNOWN } : {}) });
    this.write(all);
    this.applySecret(id, input.auth, input.secret);
    return { source: this.view(entry) };
  }

  remove(id: string): boolean {
    const all = this.readAll();
    const next = all.filter((e) => e.id !== id);
    if (next.length === all.length) return false;
    this.write(next);
    this.settings.set(secretKey(id), null);
    return true;
  }

  /** Ergebnis wird zum Status der Quelle; eine inzwischen gelöschte Quelle bleibt gelöscht. */
  private record(id: string, status: Omit<KnowledgeStatus, "failures">): KnowledgeSourceView | null {
    const all = this.readAll();
    const entry = all.find((e) => e.id === id);
    if (!entry) return null;
    entry.status = { ...status, failures: status.state === "ok" ? 0 : entry.status.failures + 1 };
    this.write(all);
    return this.view(entry);
  }

  private async run<T extends object>(id: string, fn: (source: ReturnType<typeof createMcpKnowledgeSource>) => Promise<T>): Promise<KnowledgeCall<T> | null> {
    const entry = this.readAll().find((e) => e.id === id);
    if (!entry) return null;
    const source = createMcpKnowledgeSource({
      url: entry.url,
      auth: entry.auth,
      secret: this.settings.get(secretKey(id)),
      tools: entry.tools,
      ...(this.fetchImpl ? { fetch: this.fetchImpl } : {}),
      ...(this.timeoutMs ? { timeoutMs: this.timeoutMs } : {}),
    });
    const at = () => new Date().toISOString();
    try {
      const value = await fn(source);
      const view = this.record(id, { state: "ok", at: at(), detail: null }) ?? this.view(entry);
      return { ok: true, ...value, source: view };
    } catch (err) {
      const e = err instanceof KnowledgeError ? err : new KnowledgeError("protocol", (err as Error)?.name ?? "Fehler");
      const view = this.record(id, { state: e.state, at: at(), detail: e.message }) ?? this.view(entry);
      return { ok: false, error: e.message, source: view };
    }
  }

  probe(id: string): Promise<KnowledgeCall<{ overview: KnowledgeOverview }> | null> {
    return this.run(id, async (s) => ({ overview: await s.overview() }));
  }

  search(id: string, query: KnowledgeQuery): Promise<KnowledgeCall<{ result: KnowledgeSearchResult }> | null> {
    return this.run(id, async (s) => ({ result: await s.search(query) }));
  }

  read(id: string, ref: string): Promise<KnowledgeCall<{ document: KnowledgeReadResult & { truncated: boolean } }> | null> {
    return this.run(id, async (s) => ({ document: await s.read(ref) }));
  }
}
