import { describe, expect, it } from "vitest";
import {
  KNOWLEDGE_ADD_MAX_CHARS,
  KNOWLEDGE_GRAPH_DEPTH_MAX,
  KNOWLEDGE_GRAPH_MAX_NODES,
  KnowledgeAddInput,
  KnowledgeGraphQuery,
  KnowledgeGraphResult,
  KnowledgeQuery,
  KnowledgeSourceInput,
  KNOWLEDGE_TOP_K_MAX,
  KnowledgeReadResult,
  KnowledgeSearchResult,
} from "@ancientvoid/contracts";

/** ADR-0096: Eingabe einer Wissensquelle und die Antwortformen der Fassade (EPIC-P74 §3.3.1). */
describe("KnowledgeSourceInput", () => {
  it("nimmt eine Bearer-Quelle mit Geheimnis an und füllt die Standard-Tool-Namen ein", () => {
    const parsed = KnowledgeSourceInput.parse({ label: "Librarian", url: "https://brain.example/mcp", auth: { kind: "bearer" }, secret: "s3cret-token" });
    expect(parsed.tools).toEqual({ overview: "kb_overview", search: "kb_search", read: "kb_read", graph: "kb_graph", add: "kb_add" });
  });

  it("verlangt bei auth.kind=header einen gültigen Header-Namen", () => {
    expect(KnowledgeSourceInput.safeParse({ label: "x", url: "https://x/mcp", auth: { kind: "header" } }).success).toBe(false);
    expect(KnowledgeSourceInput.safeParse({ label: "x", url: "https://x/mcp", auth: { kind: "header", header: "X Api Key" } }).success).toBe(false);
    expect(KnowledgeSourceInput.safeParse({ label: "x", url: "https://x/mcp", auth: { kind: "header", header: "X-Api-Key" } }).success).toBe(true);
  });

  it("lässt nur http(s)-URLs und harmlose Tool-Namen zu", () => {
    expect(KnowledgeSourceInput.safeParse({ label: "x", url: "file:///etc/passwd", auth: { kind: "none" } }).success).toBe(false);
    expect(KnowledgeSourceInput.safeParse({ label: "x", url: "https://x/mcp", auth: { kind: "none" }, tools: { search: "kb search; rm" } }).success).toBe(false);
  });

  it("Header-Felder, die der Transport selbst setzt, sind als eigener Auth-Header gesperrt", () => {
    expect(KnowledgeSourceInput.safeParse({ label: "x", url: "https://x/mcp", auth: { kind: "header", header: "Content-Type" } }).success).toBe(false);
  });
});

describe("KnowledgeQuery", () => {
  it("deckelt topK und verlangt einen nicht-leeren Suchtext", () => {
    expect(KnowledgeQuery.safeParse({ q: "" }).success).toBe(false);
    expect(KnowledgeQuery.safeParse({ q: "x", topK: KNOWLEDGE_TOP_K_MAX + 1 }).success).toBe(false);
    expect(KnowledgeQuery.parse({ q: "x" }).topK).toBeLessThanOrEqual(KNOWLEDGE_TOP_K_MAX);
  });
});

describe("Antwortformen der Fassade (tolerant reader)", () => {
  it("ignoriert Zusatzfelder, verlangt aber die Pflichtfelder", () => {
    expect(KnowledgeSearchResult.safeParse({ hits: [{ ref: "a", title: "A", snippet: "…", extra: 1 }], truncated: false, took: 3 }).success).toBe(true);
    expect(KnowledgeSearchResult.safeParse({ hits: [{ title: "A", snippet: "…" }], truncated: false }).success).toBe(false);
    expect(KnowledgeReadResult.safeParse({ ref: "a" }).success).toBe(false);
  });
});

describe("KnowledgeQuery (ADR-0096 Nachtrag: sichtbare Retrieval-Parameter, EPIC-134)", () => {
  it("nimmt Fusion-Modus und Score-Schwelle mit Gültigkeitsbereichen", () => {
    expect(KnowledgeQuery.parse({ q: "x", fusion: "rrf", minScore: 0.25 })).toEqual({ q: "x", topK: 8, fusion: "rrf", minScore: 0.25 });
    expect(KnowledgeQuery.safeParse({ q: "x", fusion: "hybrid" }).success).toBe(false);
    expect(KnowledgeQuery.safeParse({ q: "x", minScore: 1.5 }).success).toBe(false);
    expect(KnowledgeQuery.safeParse({ q: "x", minScore: -0.1 }).success).toBe(false);
  });
});

describe("KnowledgeGraph (T74.6)", () => {
  it("füllt Tiefe/Knoten-Limit mit Defaults und deckelt sie", () => {
    expect(KnowledgeGraphQuery.parse({ seed: "notes/a.md" })).toEqual({ seed: "notes/a.md", depth: 1, maxNodes: 40 });
    expect(KnowledgeGraphQuery.safeParse({ seed: "a", depth: KNOWLEDGE_GRAPH_DEPTH_MAX + 1 }).success).toBe(false);
    expect(KnowledgeGraphQuery.safeParse({ seed: "a", maxNodes: KNOWLEDGE_GRAPH_MAX_NODES + 1 }).success).toBe(false);
  });

  it("liest das Fassaden-Ergebnis tolerant: Zusatzfelder fallen weg, Pflichtfelder nicht", () => {
    expect(KnowledgeGraphResult.safeParse({ nodes: [{ ref: "a", title: "A", weight: 3 }], edges: [{ from: "a", to: "b", kind: "link", extra: 1 }], truncated: false }).success).toBe(true);
    expect(KnowledgeGraphResult.safeParse({ nodes: [{ title: "A" }], edges: [], truncated: false }).success).toBe(false);
    expect(KnowledgeGraphResult.safeParse({ nodes: [], edges: [{ from: "a" }], truncated: false }).success).toBe(false);
  });
});

describe("KnowledgeAddInput (T74.6)", () => {
  it("begrenzt Text und optionale Herkunft", () => {
    expect(KnowledgeAddInput.parse({ text: "Notiz", ref: "notes/neu.md", source: "vault" })).toEqual({ text: "Notiz", ref: "notes/neu.md", source: "vault" });
    expect(KnowledgeAddInput.safeParse({ text: "" }).success).toBe(false);
    expect(KnowledgeAddInput.safeParse({ text: "x".repeat(KNOWLEDGE_ADD_MAX_CHARS + 1) }).success).toBe(false);
  });
});
