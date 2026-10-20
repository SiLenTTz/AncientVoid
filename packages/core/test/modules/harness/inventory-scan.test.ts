import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { HARNESS_CATALOG, probeHarnesses, type ProbeRunner } from "../../../src/modules/harness/inventory.ts";
import { claudeDiscoverySource, scanClaudeSessions, scanCursorComposers, scanOpencodeSessions } from "../../../src/modules/discovery/sources.ts";

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
    // deepseek = dsh via ACP (ADR-0018): probing the binary, honest cells
    expect(deepseek).toMatchObject({ version: null, discovery: "missing", resume: "implemented-unverified" });
    expect(deepseek?.evidence).toContain("Probe: binary missing.");
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

  it("maps a munged project dir back to the known path — unknown names stay raw", () => {
    const root = mkdtempSync(join(tmpdir(), "uacc-claude-unmunge-"));
    // underscores become dashes too (observed live: /mnt/omarchy_data → -mnt-omarchy-data)
    const project = join(root, "projects", "-mnt-repos-my-proj");
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, "s.jsonl"), "{}\n");
    const items = scanClaudeSessions(root, "2026-09-22T00:00:00.000Z", ["/mnt/repos/anders", "/mnt/repos_my-proj"]);
    expect(items.find((item) => item.nativeSessionId === "s")?.project).toBe("/mnt/repos_my-proj");
    // ohne Treffer bleibt der gemungte Name sichtbar (fail loud, nie gedroppt)
    const unknownRoot = mkdtempSync(join(tmpdir(), "uacc-claude-unmunge2-"));
    mkdirSync(join(unknownRoot, "projects", "-tmp-wohin"), { recursive: true });
    writeFileSync(join(unknownRoot, "projects", "-tmp-wohin", "s.jsonl"), "{}\n");
    expect(scanClaudeSessions(unknownRoot, "2026-09-22T00:00:00.000Z", []).find((item) => item.nativeSessionId === "s")?.project).toBe("-tmp-wohin");
  });

  it("resolves a nested project under a root back to its real path (BUG-0057)", async () => {
    const base = mkdtempSync(join(tmpdir(), "uacc-claude-nested-"));
    const projectRoot = join(base, "work");
    const real = join(projectRoot, "30_repos", "my-proj_uxt");
    mkdirSync(real, { recursive: true }); // der Walk löst gegen echte Verzeichnisse auf
    const munged = real.replace(/[^a-zA-Z0-9]/g, "-");
    const claudeDir = join(base, "claude");
    mkdirSync(join(claudeDir, "projects", munged), { recursive: true });
    writeFileSync(join(claudeDir, "projects", munged, "s.jsonl"), "{}\n");
    const items = await claudeDiscoverySource(claudeDir, [projectRoot]).list();
    expect(items.find((item) => item.nativeSessionId === "s")?.project).toBe(real);
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

describe("scanOpencodeSessions", () => {
  it("reads sessions read-only and keeps parent_id as parentSessionId", () => {
    const root = mkdtempSync(join(tmpdir(), "uacc-opencode-scan-"));
    const db = new DatabaseSync(join(root, "opencode.db"));
    db.exec(`
      CREATE TABLE session (
        id TEXT PRIMARY KEY,
        directory TEXT,
        parent_id TEXT,
        time_created INTEGER,
        time_updated INTEGER
      )
    `);
    db.prepare("INSERT INTO session (id, directory, parent_id, time_created, time_updated) VALUES (?, ?, ?, ?, ?)")
      .run("ses_parent", "/tmp/project-a", null, 1_700_000_000_000, 1_700_000_100_000);
    db.prepare("INSERT INTO session (id, directory, parent_id, time_created, time_updated) VALUES (?, ?, ?, ?, ?)")
      .run("ses_child", "/tmp/project-a", "ses_parent", 1_700_000_050_000, 1_700_000_200_000);
    db.close();
    const items = scanOpencodeSessions(root, "2026-09-22T00:00:00.000Z");
    expect(items).toHaveLength(2);
    const parent = items.find((item) => item.nativeSessionId === "ses_parent");
    const child = items.find((item) => item.nativeSessionId === "ses_child");
    expect(parent).toMatchObject({
      adapter: "opencode",
      harness: "cli",
      controlMode: "observed",
      status: "observed",
      project: "/tmp/project-a",
      parentSessionId: null,
      unsupportedResume: false,
    });
    expect(child).toMatchObject({ parentSessionId: "ses_parent", project: "/tmp/project-a" });
    expect(new Date(child!.observedAt).toISOString()).toBe(new Date(1_700_000_200_000).toISOString());
  });

  it("stays visible when the db is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "uacc-opencode-scan-"));
    const items = scanOpencodeSessions(root, "2026-09-22T00:00:00.000Z");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ status: "unsupported-format", unsupportedResume: true, nativeSessionId: "unknown:missing-db" });
  });

  it("stays visible when the schema is not the known one", () => {
    const root = mkdtempSync(join(tmpdir(), "uacc-opencode-scan-"));
    const db = new DatabaseSync(join(root, "opencode.db"));
    db.exec("CREATE TABLE other (id TEXT)");
    db.close();
    const items = scanOpencodeSessions(root, "2026-09-22T00:00:00.000Z");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ status: "unsupported-format", unsupportedResume: true, nativeSessionId: "unknown:schema" });
  });
});
