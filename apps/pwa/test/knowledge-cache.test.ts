import { beforeEach, describe, expect, it } from "vitest";

// localStorage existiert im Node-Kontext nicht — minimaler Stub wie im Browser
// (Muster release-notes-model.test.ts), vor dem Modul-Import definiert.
const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => void store.clear(),
};

// eslint-disable-next-line import/first
import { readKnowledgeSnapshot, writeKnowledgeSnapshot, type KnowledgeSnapshot } from "../src/features/knowledge/knowledge-cache.ts";

/**
 * EPIC-P74 T74.6 (K10, F10): Offline-Kopie der letzten Übersicht — Muster
 * Automations/P49 (localStorage, Zeitstempel, Guards). Der Cache beweist nie
 * Frische; die Oberfläche zeigt sein `at` und sperrt Aktionen offline.
 */

const source = (id: string, label: string, state: string) => ({
  id,
  label,
  url: "http://librarian.test/mcp",
  auth: { kind: "bearer" },
  hasSecret: true,
  tools: { overview: "kb_overview", search: "kb_search", read: "kb_read", graph: "kb_graph", add: "kb_add" },
  createdAt: "2026-11-20T00:00:00.000Z",
  status: { state, at: "2026-11-20T00:00:00.000Z", detail: null, failures: 0 },
});

describe("knowledge-cache (K10)", () => {
  beforeEach(() => localStorage.clear());

  it("schreibt und liest eine Kopie mit Quellen, Übersicht und letzter Suche", () => {
    const snapshot: KnowledgeSnapshot = {
      at: "2026-11-20T12:00:00.000Z",
      sources: [source("id-1", "Librarian", "ok")],
      overview: { summary: "2 Dokumente", tools: ["kb_overview", "kb_search", "kb_read", "kb_graph", "kb_add"], truncated: false },
      hits: { items: [{ ref: "notes/a.md", title: "A", snippet: "…" }], truncated: false },
    };
    writeKnowledgeSnapshot(snapshot);
    expect(readKnowledgeSnapshot()).toEqual(snapshot);
  });

  it("verwirft kaputte und unvollständige Kopien (null statt Glauben)", () => {
    expect(readKnowledgeSnapshot()).toBeNull();
    localStorage.setItem("ancientvoid.knowledge.v1", "kein json");
    expect(readKnowledgeSnapshot()).toBeNull();
    localStorage.setItem("ancientvoid.knowledge.v1", JSON.stringify({ at: "nicht-iso", sources: [] }));
    expect(readKnowledgeSnapshot()).toBeNull();
    localStorage.setItem(
      "ancientvoid.knowledge.v1",
      JSON.stringify({ at: "2026-11-20T12:00:00.000Z", sources: [{ id: "x" }, "kein objekt"] }),
    );
    const read = readKnowledgeSnapshot();
    expect(read).not.toBeNull();
    expect(read?.sources).toEqual([]);
  });

  it("trägt nie ein Geheimnis — die Kopie kennt nur die Projektion der Liste", () => {
    writeKnowledgeSnapshot({ at: "2026-11-20T12:00:00.000Z", sources: [source("id-1", "Librarian", "ok")] });
    expect(localStorage.getItem("ancientvoid.knowledge.v1")).not.toContain("secret");
  });
});
