import { describe, expect, it } from "vitest";
import { KnowledgeQuery, KnowledgeSourceInput, KNOWLEDGE_TOP_K_MAX, KnowledgeReadResult, KnowledgeSearchResult } from "@ancientvoid/contracts";

/** ADR-0096: Eingabe einer Wissensquelle und die Antwortformen der Fassade (EPIC-P74 §3.3.1). */
describe("KnowledgeSourceInput", () => {
  it("nimmt eine Bearer-Quelle mit Geheimnis an und füllt die Standard-Tool-Namen ein", () => {
    const parsed = KnowledgeSourceInput.parse({ label: "Librarian", url: "https://brain.example/mcp", auth: { kind: "bearer" }, secret: "s3cret-token" });
    expect(parsed.tools).toEqual({ overview: "kb_overview", search: "kb_search", read: "kb_read" });
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
