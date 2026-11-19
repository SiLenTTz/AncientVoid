import { z } from "zod";

/**
 * ADR-0096 (EPIC-P74): Wissensquellen. Der Hub spricht als generischer
 * MCP-Client mit jedem Knowledge-Server, der die Tool-Schnittstelle v1
 * (EPIC-P74 §3.3.1) hält — zuerst die Librarian-Fassade. Eine Quelle ist
 * Konfiguration, kein Code. Alles, was zurückkommt, ist Daten, nie
 * Anweisung (PRD §8.5).
 */

export const KNOWLEDGE_MAX_SOURCES = 16;
export const KNOWLEDGE_TIMEOUT_MS = 10_000;
export const KNOWLEDGE_TOP_K_DEFAULT = 8;
export const KNOWLEDGE_TOP_K_MAX = 20;
/** Caps der Hub-Antworten (K5-Geist): längeres wird gekürzt und als `truncated` markiert. */
export const KNOWLEDGE_SNIPPET_MAX_CHARS = 600;
export const KNOWLEDGE_SUMMARY_MAX_CHARS = 2_000;
export const KNOWLEDGE_CONTENT_MAX_CHARS = 32_000;

export const KNOWLEDGE_AUTH_KINDS = ["none", "bearer", "header"] as const;
export type KnowledgeAuthKind = (typeof KNOWLEDGE_AUTH_KINDS)[number];

export const KNOWLEDGE_DEFAULT_TOOLS = { overview: "kb_overview", search: "kb_search", read: "kb_read" } as const;

/** Header, die der MCP-Transport selbst setzt — als eigener Auth-Header würden sie das Protokoll brechen. */
const RESERVED_HEADERS = new Set(["accept", "content-type", "content-length", "host", "mcp-session-id", "mcp-protocol-version", "last-event-id"]);

const HttpUrl = z
  .string()
  .trim()
  .url()
  .max(300)
  .refine((u) => /^https?:\/\//i.test(u), "nur http(s)");

const ToolName = z.string().trim().regex(/^[A-Za-z0-9_.-]{1,64}$/, "Tool-Name: Buchstaben, Ziffern, _ . -");

export const KnowledgeAuth = z
  .object({
    kind: z.enum(KNOWLEDGE_AUTH_KINDS),
    /** Nur bei kind=header: Name des Headers, der das Geheimnis trägt (z. B. X-Api-Key). */
    header: z.string().trim().regex(/^[A-Za-z0-9-]{1,64}$/, "Header-Name: Buchstaben, Ziffern, -").optional(),
  })
  .refine((a) => a.kind !== "header" || a.header !== undefined, { message: "Header-Name fehlt", path: ["header"] })
  .refine((a) => a.header === undefined || !RESERVED_HEADERS.has(a.header.toLowerCase()), { message: "Header ist dem Transport vorbehalten", path: ["header"] });
export type KnowledgeAuth = z.infer<typeof KnowledgeAuth>;

export const KnowledgeSourceInput = z.object({
  label: z.string().trim().min(1).max(80),
  url: HttpUrl,
  auth: KnowledgeAuth,
  /** Write-only: undefined = unverändert, null = entfernen, String = ersetzen. */
  secret: z.string().trim().min(8).max(1000).nullable().optional(),
  tools: z
    .object({ overview: ToolName.optional(), search: ToolName.optional(), read: ToolName.optional() })
    .default({})
    .transform((t) => ({ overview: t.overview ?? KNOWLEDGE_DEFAULT_TOOLS.overview, search: t.search ?? KNOWLEDGE_DEFAULT_TOOLS.search, read: t.read ?? KNOWLEDGE_DEFAULT_TOOLS.read })),
});
export type KnowledgeSourceInput = z.infer<typeof KnowledgeSourceInput>;
/** Was ein Aufrufer schicken darf (vor dem Füllen der Standard-Tool-Namen). */
export type KnowledgeSourceInputRaw = z.input<typeof KnowledgeSourceInput>;
export type KnowledgeTools = KnowledgeSourceInput["tools"];

/**
 * Zustand einer Quelle nach dem letzten Aufruf (Fail loud, ADR-0096 §5).
 * unreachable: kein HTTP-Kontakt/Zeitüberschreitung · unauthorized: 401/403 ·
 * protocol: kein MCP, Tool fehlt, Antwortform falsch · tool-error: das Tool meldet `isError`.
 */
export const KNOWLEDGE_STATES = ["unknown", "ok", "unreachable", "unauthorized", "protocol", "tool-error"] as const;
export type KnowledgeState = (typeof KNOWLEDGE_STATES)[number];

export interface KnowledgeStatus {
  state: KnowledgeState;
  at: string | null;
  /** Kurz, ohne Geheimnis und ohne URL-Query. */
  detail: string | null;
  /** Fehlschläge in Folge; 0 nach jedem Erfolg. */
  failures: number;
}

export interface KnowledgeSourceView {
  id: string;
  label: string;
  url: string;
  auth: KnowledgeAuth;
  hasSecret: boolean;
  tools: KnowledgeTools;
  createdAt: string;
  status: KnowledgeStatus;
}

export const KnowledgeQuery = z.object({
  q: z.string().trim().min(1).max(500),
  topK: z.number().int().min(1).max(KNOWLEDGE_TOP_K_MAX).default(KNOWLEDGE_TOP_K_DEFAULT),
});
export type KnowledgeQuery = z.infer<typeof KnowledgeQuery>;

/* Antwortformen der Fassade (§3.3.1). Tolerant: Zusatzfelder fallen weg, Pflichtfelder nicht. */

export const KnowledgeOverviewResult = z.object({
  summary: z.string(),
  protocol: z.string().optional(),
});
export type KnowledgeOverviewResult = z.infer<typeof KnowledgeOverviewResult>;

export const KnowledgeHit = z.object({
  ref: z.string().min(1),
  title: z.string(),
  score: z.number().optional(),
  snippet: z.string(),
  source: z.string().optional(),
});
export type KnowledgeHit = z.infer<typeof KnowledgeHit>;

export const KnowledgeSearchResult = z.object({
  hits: z.array(KnowledgeHit),
  truncated: z.boolean(),
});
export type KnowledgeSearchResult = z.infer<typeof KnowledgeSearchResult>;

export const KnowledgeReadResult = z.object({
  ref: z.string().min(1),
  title: z.string().optional(),
  content: z.string(),
  outlinks: z.array(z.string()).optional(),
  backlinks: z.array(z.string()).optional(),
  truncated: z.boolean().optional(),
});
export type KnowledgeReadResult = z.infer<typeof KnowledgeReadResult>;

/** Hub-Antwort der Übersicht: Fassaden-Text plus die beim Prüfen gefundenen Tool-Namen. */
export interface KnowledgeOverview extends KnowledgeOverviewResult {
  tools: string[];
  truncated: boolean;
}

/**
 * Eine angebundene Wissensquelle, wie Hub-Kern und Routen sie sehen (ADR-0096).
 * `graph` und `add` (Freigaben-Queue) kommen als Nachtrag zum ADR.
 */
export interface KnowledgeSource {
  overview(): Promise<KnowledgeOverview>;
  search(query: KnowledgeQuery): Promise<KnowledgeSearchResult>;
  read(ref: string): Promise<KnowledgeReadResult & { truncated: boolean }>;
}
