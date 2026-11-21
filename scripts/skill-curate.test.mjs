// Tier A: keine Ports, keine Wanduhr-Abhängigkeit, alles auf Temp-Kopien.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, cpSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { curate } from "./skill-curate.mjs";
import { checkSubject } from "./commit-notation.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const caseFile = (name) => join(here, "skill-regression", "cases", name);

let tmp;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "curate-")); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

function git(cwd, ...args) { return execFileSync("git", args, { cwd, encoding: "utf8" }); }

// Volle Arbeits-Kopie für --apply: Skills, Doku-ankerquellen, scripts, package.json.
function mirrorForApply() {
  const root = join(tmp, "repo");
  mkdirSync(root, { recursive: true });
  for (const p of [".claude", "docs", "epics", "bugs", "scripts", "AGENTS.md", "CONTRIBUTING.md", "package.json", "setup.sh"]) {
    cpSync(join(here, "..", p), join(root, p), { recursive: true });
  }
  git(root, "init", "-q"); git(root, "config", "user.email", "t@t"); git(root, "config", "user.name", "t");
  git(root, "add", "-A"); git(root, "commit", "-qm", "init");
  return root;
}

describe("skill-curate (T72.9/T72.10)", () => {
  it("AC-P72-6: dieselbe Signatur in einer Session ergibt NO_CHANGE", async () => {
    const r = await curate({ runs: caseFile("scenario-ein-session.json"), stateDir: join(tmp, "state") });
    expect(r.verdict).toBe("NO_CHANGE");
    expect(r.lessons).toEqual([]);
  });

  it("AC-P72-6: derselbe Regeltreffer in zwei Sessions wird Lektion mit beiden IDs", async () => {
    const r = await curate({ runs: caseFile("scenario-zwei-sessions-regeltreffer.json"), stateDir: join(tmp, "state") });
    const lesson = r.lessons.find((l) => l.id === "gw-no-verify");
    expect(lesson).toBeTruthy();
    expect(lesson.classification).toBe("deterministic");
    expect(lesson.evidence_task_ids).toEqual(["sc-2a", "sc-2b"]);
  });

  it("AC-P72-7: Befehlsfolge in drei Sessions wird Skript-Kandidat ohne Diff", async () => {
    const r = await curate({ runs: caseFile("scenario-drei-sessions-folge.json"), stateDir: join(tmp, "state") });
    const l = r.lessons[0];
    expect(l).toBeTruthy();
    expect(l.classification).toBe("deterministic");
    expect(l.evidence_task_ids).toEqual(["sc-3a", "sc-3b", "sc-3c"]);
    expect(l.diffs).toEqual([]);
  });

  it("AC-P72-9: Fehler ohne Befehlsmuster wird probabilistisch, nur Vorschlag ohne Diff", async () => {
    const r = await curate({ runs: caseFile("scenario-probabilistisch.json"), stateDir: join(tmp, "state") });
    const l = r.lessons.find((x) => x.classification === "probabilistic");
    expect(l).toBeTruthy();
    expect(l.evidence_task_ids).toEqual(["sc-4a", "sc-4b"]);
    expect(l.diffs).toEqual([]);
    expect(existsSync(join(tmp, "state", "proposals", "prob-blocked.json"))).toBe(true);
  });

  it("AC-P72-10: Injection-Text in Agenten-Output erzeugt weder Regel noch Diff", async () => {
    const r = await curate({ runs: caseFile("scenario-injection.json"), stateDir: join(tmp, "state") });
    expect(r.lessons).toEqual([]);
    expect(r.verdict).toBe("NO_CHANGE");
  });

  it("Max-2: drei würdige Lektionen, zwei werden gemeldet", async () => {
    const r = await curate({ runs: caseFile("scenario-max-drei.json"), stateDir: join(tmp, "state") });
    expect(r.lessons.length).toBe(2);
    expect(r.truncated_lessons).toBe(1);
  });

  it("AC-P72-11: zweiter Lauf ohne neue Runs ergibt NO_CHANGE, Cursor unverändert", async () => {
    const stateDir = join(tmp, "state");
    await curate({ runs: caseFile("scenario-zwei-sessions-regeltreffer.json"), stateDir });
    const cursorAfter1 = readFileSync(join(stateDir, "cursor.json"), "utf8");
    const r2 = await curate({ runs: caseFile("scenario-zwei-sessions-regeltreffer.json"), stateDir });
    expect(r2.verdict).toBe("NO_CHANGE");
    expect(readFileSync(join(stateDir, "cursor.json"), "utf8")).toBe(cursorAfter1);
  });

  it("AC-P72-8: --apply mit Diff, der einen Regressionsfall bricht → REJECTED, Arbeitsbaum sauber", async () => {
    const root = mirrorForApply();
    const catalogPath = join(root, ".claude", "skills", "_shared", "skill-checks.json");
    expect(checkSkillsRoot(root)).toBe(true); // Ausgangslage grün
    const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
    catalog["*"][0].match = "^git commit -m x$"; // trifft gw-no-verify.negative.json → erwartet nohit → bricht
    const diffFile = join(tmp, "diff.json");
    writeFileSync(diffFile, JSON.stringify([{ file: join(".claude", "skills", "_shared", "skill-checks.json"), content: JSON.stringify(catalog, null, 2) + "\n" }]));
    const r = await curate({ runs: [], stateDir: join(tmp, "state"), apply: true, diffFile, skillRoot: root, catalogPath });
    expect(r.verdict).toBe("REJECTED");
    expect(r.regression_results.failed).toBeGreaterThan(0);
    expect(readFileSync(catalogPath, "utf8")).not.toBe(JSON.stringify(catalog, null, 2) + "\n");
    expect(git(root, "status", "--porcelain")).toBe("");
  });

  it("ACCEPTED: grüner Diff bleibt, Commit-Nachricht ist notationskonform", async () => {
    const root = mirrorForApply();
    const catalogPath = join(root, ".claude", "skills", "_shared", "skill-checks.json");
    const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
    catalog["*"].push({ id: "test-neue-regel", kind: "forbid", scope: "invoked", match: "^git push\\b.*\\bzweigt\\b", anchor: "Kein Force-Push" });
    // jede Regel im Katalog braucht einen Regressionsfall — auch die neue:
    const regDir = join(root, "scripts", "skill-regression");
    const expected = JSON.parse(readFileSync(join(regDir, "expected.json"), "utf8"));
    expected["test-neue-regel"] = { positive: "hit", negative: "nohit" };
    writeFileSync(join(regDir, "expected.json"), JSON.stringify(expected, null, 2) + "\n");
    writeFileSync(join(regDir, "cases", "test-neue-regel.positive.json"), JSON.stringify({ sessionId: "t", commands: [{ seq: 1, cmd: "git push origin zweigt", error: null, exit: null }] }, null, 2) + "\n");
    writeFileSync(join(regDir, "cases", "test-neue-regel.negative.json"), JSON.stringify({ sessionId: "t", commands: [{ seq: 1, cmd: "git push origin main", error: null, exit: null }] }, null, 2) + "\n");
    const diffFile = join(tmp, "diff.json");
    writeFileSync(diffFile, JSON.stringify([{ file: join(".claude", "skills", "_shared", "skill-checks.json"), content: JSON.stringify(catalog, null, 2) + "\n" }]));
    const r = await curate({ runs: [], stateDir: join(tmp, "state"), apply: true, diffFile, skillRoot: root, catalogPath });
    expect(r.verdict).toBe("ACCEPTED");
    expect(r.commit_message).toBeTruthy();
    expect(checkSubject(r.commit_message)).toBeNull(); // null = Notation ok
    expect(git(root, "status", "--porcelain")).not.toBe(""); // Diff liegt im Arbeitsbaum
  });

  it("Falscher Anker im Ziel-Arbeitsbaum → REJECTED (check:skills rot)", async () => {
    const root = mirrorForApply();
    const catalogPath = join(root, ".claude", "skills", "_shared", "skill-checks.json");
    const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
    catalog["*"].push({ id: "test-ohne-anker", kind: "forbid", scope: "invoked", match: "^xyz$" });
    catalog["*"][2].anchor = "Dieser Anker steht nirgends im Haus";
    const diffFile = join(tmp, "diff.json");
    writeFileSync(diffFile, JSON.stringify([{ file: join(".claude", "skills", "_shared", "skill-checks.json"), content: JSON.stringify(catalog, null, 2) + "\n" }]));
    const r = await curate({ runs: [], stateDir: join(tmp, "state"), apply: true, diffFile, skillRoot: root, catalogPath });
    expect(r.verdict).toBe("REJECTED");
    expect(git(root, "status", "--porcelain")).toBe("");
  });
});

function checkSkillsRoot(root) {
  try {
    execFileSync("node", [join(root, "scripts", "check-skills.mjs"), "--json"], { cwd: root, encoding: "utf8", stdio: "pipe" });
    return true; // exit 0 = keine Findings
  } catch {
    return false;
  }
}
