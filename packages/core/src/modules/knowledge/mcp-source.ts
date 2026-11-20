import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import {
  KNOWLEDGE_CONTENT_MAX_CHARS,
  KNOWLEDGE_GRAPH_MAX_EDGES,
  KNOWLEDGE_SNIPPET_MAX_CHARS,
  KNOWLEDGE_SUMMARY_MAX_CHARS,
  KNOWLEDGE_TIMEOUT_MS,
  KnowledgeAddResult,
  KnowledgeGraphResult,
  KnowledgeOverviewResult,
  KnowledgeReadResult,
  KnowledgeSearchResult,
  type KnowledgeAddInput,
  type KnowledgeAuth,
  type KnowledgeOverview,
  type KnowledgeQuery,
  type KnowledgeSource,
  type KnowledgeState,
  type KnowledgeTools,
} from "@ancientvoid/contracts";

/** Ein Fehlschlag mit dem Zustand, den die Quelle danach zeigt. `message` trägt nie ein Geheimnis. */
export class KnowledgeError extends Error {
  readonly state: Exclude<KnowledgeState, "ok" | "unknown">;

  constructor(state: Exclude<KnowledgeState, "ok" | "unknown">, detail: string) {
    super(detail.slice(0, 200));
    this.name = "KnowledgeError";
    this.state = state;
  }
}

export interface McpSourceConfig {
  url: string;
  auth: KnowledgeAuth;
  secret: string | null;
  tools: KnowledgeTools;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

function cap(text: string, max: number): { text: string; cut: boolean } {
  return text.length > max ? { text: `${text.slice(0, max - 1)}…`, cut: true } : { text, cut: false };
}

/** Fehlerkode ohne Nachrichtentext: SDK-Meldungen können den Antwort-Body des Servers enthalten. */
function classify(err: unknown, timeoutMs: number): KnowledgeError {
  if (err instanceof KnowledgeError) return err;
  if (err instanceof StreamableHTTPError) {
    const code = err.code ?? 0;
    if (code === 401 || code === 403) return new KnowledgeError("unauthorized", `HTTP ${code}`);
    if (code === 502 || code === 503 || code === 504) return new KnowledgeError("unreachable", `HTTP ${code}`);
    return new KnowledgeError("protocol", code > 0 ? `HTTP ${code} — kein MCP-Endpunkt unter dieser Adresse?` : "Antwort ist kein MCP (Content-Type)");
  }
  if (err instanceof McpError) {
    if (err.code === ErrorCode.RequestTimeout) return new KnowledgeError("unreachable", `Zeitüberschreitung (${timeoutMs / 1000} s)`);
    return new KnowledgeError("protocol", `MCP-Fehler ${err.code}`);
  }
  const e = err as { name?: string; cause?: { code?: string; errors?: { code?: string }[] } };
  if (e?.name === "AbortError" || e?.name === "TimeoutError") return new KnowledgeError("unreachable", `Zeitüberschreitung (${timeoutMs / 1000} s)`);
  const code = e?.cause?.code ?? e?.cause?.errors?.[0]?.code;
  if (code || err instanceof TypeError) return new KnowledgeError("unreachable", String(code ?? "fetch failed"));
  return new KnowledgeError("protocol", e?.name ?? "unbekannter Fehler");
}

function authHeaders(auth: KnowledgeAuth, secret: string | null): Record<string, string> {
  if (!secret || auth.kind === "none") return {};
  if (auth.kind === "bearer") return { authorization: `Bearer ${secret}` };
  return { [auth.header!.toLowerCase()]: secret };
}

type ToolResult = { isError?: boolean; structuredContent?: unknown; content?: unknown };

/** `structuredContent` zuerst, sonst der erste Text-Block als JSON (EPIC-P74 §3.3.1 Regel 1). */
function parseResult<T extends z.ZodType>(tool: string, raw: ToolResult, schema: T): z.infer<T> {
  const texts = Array.isArray(raw.content) ? (raw.content as { type?: string; text?: string }[]).filter((c) => c.type === "text" && typeof c.text === "string") : [];
  if (raw.isError) throw new KnowledgeError("tool-error", `${tool}: ${texts[0]?.text ?? "Fehler ohne Meldung"}`);
  let data = raw.structuredContent;
  if (data === undefined && texts[0]) {
    try {
      data = JSON.parse(texts[0].text!);
    } catch {
      throw new KnowledgeError("protocol", `${tool}: Antwort ist kein JSON`);
    }
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new KnowledgeError("protocol", `${tool}: Antwort passt nicht zu v1 (${issue?.path.join(".") || "Wurzel"}: ${issue?.code ?? "?"})`);
  }
  return parsed.data;
}

/**
 * ADR-0096: generischer MCP-Client für eine Wissensquelle. Pro Aufruf eine
 * kurze Verbindung (die Fassade ist stateless, §3.3); keine Retries — ein
 * Fehlschlag wird zum Status der Quelle, nicht zu stiller Wiederholung.
 */
export function createMcpKnowledgeSource(cfg: McpSourceConfig): KnowledgeSource & { listTools(): Promise<string[]> } {
  const timeoutMs = cfg.timeoutMs ?? KNOWLEDGE_TIMEOUT_MS;

  /** Eine Frist für den ganzen Aufruf (Verbinden + alle Schritte), nicht je MCP-Anfrage. */
  async function withClient<T>(fn: (client: Client, opts: { timeout: number; signal: AbortSignal }) => Promise<T>): Promise<T> {
    const opts = { timeout: timeoutMs, signal: AbortSignal.timeout(timeoutMs) };
    const client = new Client({ name: "ancientvoid-hub", version: "0.1.0" });
    const transport = new StreamableHTTPClientTransport(new URL(cfg.url), {
      // redirect "error": ein Umweg darf das Geheimnis nicht zu einem anderen Host tragen.
      requestInit: { headers: authHeaders(cfg.auth, cfg.secret), redirect: "error" },
      ...(cfg.fetch ? { fetch: cfg.fetch } : {}),
    });
    try {
      await client.connect(transport, opts);
      return await fn(client, opts);
    } catch (err) {
      throw classify(err, timeoutMs);
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  type Opts = { timeout: number; signal: AbortSignal };

  async function call<T extends z.ZodType>(client: Client, opts: Opts, tool: string, args: Record<string, unknown>, schema: T): Promise<z.infer<T>> {
    const raw = (await client.callTool({ name: tool, arguments: args }, undefined, opts)) as ToolResult;
    return parseResult(tool, raw, schema);
  }

  async function listTools(client: Client, opts: Opts): Promise<string[]> {
    const { tools } = await client.listTools(undefined, opts);
    return tools.map((t) => t.name);
  }

  return {
    listTools: () => withClient(listTools),

    /** Prüfen: alle drei Tools vorhanden, dann kb_overview als Healthcheck (§3.3.1 Regel 4). */
    overview: () =>
      withClient(async (client, opts): Promise<KnowledgeOverview> => {
        const tools = await listTools(client, opts);
        const missing = [cfg.tools.overview, cfg.tools.search, cfg.tools.read].filter((t) => !tools.includes(t));
        if (missing.length) throw new KnowledgeError("protocol", `Tool fehlt: ${missing.join(", ")}`);
        const res = await call(client, opts, cfg.tools.overview, {}, KnowledgeOverviewResult);
        const summary = cap(res.summary, KNOWLEDGE_SUMMARY_MAX_CHARS);
        const protocol = res.protocol === undefined ? undefined : cap(res.protocol, KNOWLEDGE_SUMMARY_MAX_CHARS);
        return { summary: summary.text, ...(protocol ? { protocol: protocol.text } : {}), tools, truncated: summary.cut || (protocol?.cut ?? false) };
      }),

    search: (query: KnowledgeQuery) =>
      withClient(async (client, opts) => {
        const res = await call(client, opts, cfg.tools.search, { q: query.q, topK: query.topK, ...("fusion" in query ? { fusion: query.fusion } : {}), ...("minScore" in query ? { minScore: query.minScore } : {}) }, KnowledgeSearchResult);
        let truncated = res.truncated || res.hits.length > query.topK;
        const hits = res.hits.slice(0, query.topK).map((h) => {
          const snippet = cap(h.snippet, KNOWLEDGE_SNIPPET_MAX_CHARS);
          if (snippet.cut) truncated = true;
          return { ...h, snippet: snippet.text };
        });
        return { hits, truncated };
      }),

    read: (ref: string) =>
      withClient(async (client, opts) => {
        const res = await call(client, opts, cfg.tools.read, { ref }, KnowledgeReadResult);
        const content = cap(res.content, KNOWLEDGE_CONTENT_MAX_CHARS);
        return { ...res, content: content.text, truncated: content.cut || (res.truncated ?? false) };
      }),

    /** Nachbarn/Pfad einer Ref — optionales Tool: fehlt es, ist das ein sauberer Protokollfehler. */
    graph: (query) =>
      withClient(async (client, opts) => {
        const tools = await listTools(client, opts);
        if (!tools.includes(cfg.tools.graph)) throw new KnowledgeError("protocol", `Tool fehlt: ${cfg.tools.graph}`);
        const res = await call(client, opts, cfg.tools.graph, { seed: query.seed, depth: query.depth, maxNodes: query.maxNodes }, KnowledgeGraphResult);
        const nodes = res.nodes.slice(0, query.maxNodes);
        const edges = res.edges.slice(0, KNOWLEDGE_GRAPH_MAX_EDGES);
        const known = nodes.length < res.nodes.length || edges.length < res.edges.length;
        return { nodes, edges, truncated: res.truncated || known };
      }),

    /** Schreiben — ruft NIE jemand direkt auf: der Service lässt eine Freigabe davor (EPIC-P74 §3.6). */
    add: (input: KnowledgeAddInput) =>
      withClient(async (client, opts) => {
        const tools = await listTools(client, opts);
        if (!tools.includes(cfg.tools.add)) throw new KnowledgeError("protocol", `Tool fehlt: ${cfg.tools.add}`);
        return call(client, opts, cfg.tools.add, input, KnowledgeAddResult);
      }),
  };
}
