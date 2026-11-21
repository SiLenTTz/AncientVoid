import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, cpSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { extractRuns, classifyResult } from "./skill-runs.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = join(here, "fixtures", "skill-runs");

describe("skill-runs extract (T72.6)", () => {
  it("liefert fuer jede Adapter-Fixture den erwarteten Datensatz", () => {
    const runs = extractRuns(fixtureRoot);
    const expected = JSON.parse(readFixture("expected.json"));
    expect(runs).toEqual(expected);
  });

  it("ist deterministisch: zweimal hintereinander byte-gleich", () => {
    expect(JSON.stringify(extractRuns(fixtureRoot))).toBe(JSON.stringify(extractRuns(fixtureRoot)));
  });

  it("maki- und opencode-Fixtures zeigen shellWithoutCommand > 0 statt fehlender Zeilen", () => {
    const runs = extractRuns(fixtureRoot);
    const maki = runs.find((r) => r.adapter === "maki");
    const opencode = runs.find((r) => r.adapter === "opencode");
    expect(maki.unparsed.shellWithoutCommand).toBeGreaterThan(0);
    expect(opencode.unparsed.shellWithoutCommand).toBeGreaterThan(0);
  });

  it("resolviert K5-Blobs und zaehlt fehlende Blobs sichtbar (blobMissing)", () => {
    const runs = extractRuns(fixtureRoot);
    const claude = runs.find((r) => r.adapter === "claude");
    expect(claude.commands.map((c) => c.cmd)).toContain("npm run test:fast"); // kam aus dem Blob
    const tmp = tmpFixtureCopy();
    rmSync(join(tmp, "sessions", "a0000000-0000-4000-8000-000000000001", "blobs", "aaa111"));
    const run = extractRuns(tmp).find((r) => r.adapter === "claude");
    expect(run.unparsed.blobMissing).toBe(1);
    expect(run.commands.map((c) => c.cmd)).not.toContain("npm run test:fast");
    rmSync(tmp, { recursive: true, force: true });
  });

  it("joinet turn_metrics ueber hub.db (read-only)", () => {
    const tmp = tmpFixtureCopy();
    const db = new DatabaseSync(join(tmp, "hub.db"));
    db.exec("CREATE TABLE turn_metrics (session_id TEXT, tokens INTEGER, tokens_source TEXT, cost_usd REAL)");
    db.prepare("INSERT INTO turn_metrics VALUES (?, ?, ?, ?)").run("a0000000-0000-4000-8000-000000000005", 1200, "native", 0.04);
    db.prepare("INSERT INTO turn_metrics VALUES (?, ?, ?, ?)").run("a0000000-0000-4000-8000-000000000005", 800, "native", 0.01);
    db.close();
    const pi = extractRuns(tmp).find((r) => r.adapter === "pi");
    expect(pi.cost).toEqual({ usd: 0.05, tokens: 2000, source: "native", turns: 2 });
    rmSync(tmp, { recursive: true, force: true });
  });

  it("filtert nach --since und --project", () => {
    expect(extractRuns(fixtureRoot, { since: "2026-11-19T00:00:00.000Z" })).toEqual([]);
    expect(extractRuns(fixtureRoot, { since: "2026-11-17T00:00:00.000Z" })).toHaveLength(5);
    expect(extractRuns(fixtureRoot, { project: "anderesprojekt" })).toEqual([]);
  });

  it("ueberspringt stream_event-Zeilen (claude-Fixture: genau 2 Befehle)", () => {
    const claude = extractRuns(fixtureRoot).find((r) => r.adapter === "claude");
    expect(claude.commands).toHaveLength(2);
    expect(claude.skills).toEqual({ chain: ["git-workflow"], invoked: ["git-workflow"] });
  });
});

describe("classifyResult — Exit-Formate und Fehlerklassen (nur erste Zeile, nur die Zahl)", () => {
  it.each([
    ["exit code 2", 2],
    ["exit code: 3", 3],
    ["exited with code 1", 1],
    ["Process exited with code 1", 1],
    ["Exit code 130", 130],
  ])("Erstes Format: %s → exit %i", (line, n) => {
    expect(classifyResult(line, true)).toEqual({ error: "exit-nonzero", exit: n });
  });

  it("exit 0 auf erster Zeile ist ok", () => {
    expect(classifyResult("exit code 0", false)).toEqual({ error: null, exit: 0 });
  });

  it("Zahl erst ab Zeile 2 zaehlt nicht (isError bleibt Klasse ohne exit)", () => {
    expect(classifyResult("failure\nexit code 7", true)).toEqual({ error: "error", exit: null });
  });

  it("Präfix-Klassen: permission-denied, blocked, approval-timeout", () => {
    expect(classifyResult("Permission denied by user", true).error).toBe("permission-denied");
    expect(classifyResult("Blocked: sleep 30 in automation", true).error).toBe("blocked");
    expect(classifyResult("Keine Freigabe innerhalb 60s", true).error).toBe("approval-timeout");
  });

  it("isError ohne Muster → error ohne exit", () => {
    expect(classifyResult("irgendwas schiefgelaufen", true)).toEqual({ error: "error", exit: null });
  });
});

function readFixture(name) {
  return readFileSync(join(fixtureRoot, name), "utf8");
}
function tmpFixtureCopy() {
  const tmp = mkdtempSync(join(tmpdir(), "skill-runs-"));
  cpSync(fixtureRoot, tmp, { recursive: true });
  return tmp;
}
