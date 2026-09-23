import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { HARNESS_CATALOG, probeHarnesses, type ProbeRunner } from "../../../src/modules/harness/inventory.ts";
import { scanClaudeSessions, scanCursorComposers } from "../../../src/modules/discovery/sources.ts";

describe("probeHarnesses (T5.1)", () => {
  it("records a parsed version and does not upgrade a missing discovery cell", async () => {
    const runner: ProbeRunner = {
      async run(command) {
        if (command === "claude") return { code: 0, output: "2.1.263 (Claude Code)\n" };
        return { code: 127, output: "", missing: true };
      },
    };
    const items = await probeHarnesses(HARNESS_CATALOG, runner);
    const claude = items.find((item) => item.id === "claude");
    const codex = items.find((item) => item.id === "codex");
    const deepseek = items.find((item) => item.id === "deepseek");
    expect(claude).toMatchObject({ version: "2.1.263", discovery: "verified", resume: "implemented-unverified" });
    expect(claude?.evidence).toContain("Probe: 2.1.263.");
    expect(codex).toMatchObject({ version: null, discovery: "missing" });
    expect(codex?.evidence).toContain("Probe: binary missing.");
    expect(deepseek).toMatchObject({ version: null, discovery: "blocked", resume: "blocked" });
    expect(deepseek?.evidence).toContain("Probe: no binary");
  });
});

describe("scanClaudeSessions (T5.3)", () => {
  it("lists transcripts, keeps a subagent parent, and shows an unknown file", () => {
    const root = mkdtempSync(join(tmpdir(), "uacc-claude-scan-"));
    const project = join(root, "projects", "-tmp-demo");
    mkdirSync(join(project, "sess-1", "subagents"), { recursive: true });
    mkdirSync(join(project, "memory"), { recursive: true });
    writeFileSync(join(project, "sess-1.jsonl"), "{}\n");
    writeFileSync(join(project, "sess-1", "subagents", "agent-a.jsonl"), "{}\n");
    writeFileSync(join(project, "notes.txt"), "not a transcript\n");
    const items = scanClaudeSessions(root, "2026-09-22T00:00:00.000Z");
    const main = items.find((item) => item.nativeSessionId === "sess-1");
    const child = items.find((item) => item.nativeSessionId === "agent-a");
    const unknown = items.find((item) => item.status === "unsupported-format");
    expect(main).toMatchObject({ adapter: "claude", parentSessionId: null, controlMode: "observed", project: "-tmp-demo" });
    expect(child).toMatchObject({ parentSessionId: "sess-1", adapter: "claude" });
    expect(unknown).toMatchObject({ nativeSessionId: "unknown:notes.txt", unsupportedResume: true });
    expect(items.some((item) => item.nativeSessionId === "memory")).toBe(false);
  });
});

describe("scanCursorComposers (T5.3)", () => {
  it("reads composers read-only and keeps a parent column when the schema has one", () => {
    const root = mkdtempSync(join(tmpdir(), "uacc-cursor-scan-"));
    const dbPath = join(root, "globalStorage", "state.vscdb");
    mkdirSync(join(root, "globalStorage"), { recursive: true });
    const db = new DatabaseSync(dbPath);
    db.exec(
      "CREATE TABLE composerHeaders (composerId TEXT, workspaceId TEXT, lastUpdatedAt INTEGER, isSubagent INTEGER, parentComposerId TEXT)",
    );
    db.prepare("INSERT INTO composerHeaders VALUES (?, ?, ?, ?, ?)").run("child", "ws-1", 1_700_000_000_000, 1, "parent");
    db.close();
    const items = scanCursorComposers(root);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      adapter: "cursor-clip",
      harness: "ide",
      nativeSessionId: "child",
      parentSessionId: "parent",
      status: "subagent",
      project: "ws-1",
    });
  });

  it("stays visible when the schema is not the known one", () => {
    const root = mkdtempSync(join(tmpdir(), "uacc-cursor-bad-"));
    mkdirSync(join(root, "globalStorage"), { recursive: true });
    const db = new DatabaseSync(join(root, "globalStorage", "state.vscdb"));
    db.exec("CREATE TABLE other (id TEXT)");
    db.close();
    const items = scanCursorComposers(root, "2026-09-22T00:00:00.000Z");
    expect(items[0]).toMatchObject({ status: "unsupported-format", unsupportedResume: true, nativeSessionId: "unknown:schema" });
  });
});
