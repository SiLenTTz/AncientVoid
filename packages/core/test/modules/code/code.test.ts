import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActionDefinition, actionArgv, type EmittedEvent } from "@ancientvoid/contracts";
import { ActionRunner, BUILTIN_ACTIONS, containedFile, definitionPattern, desktopEnv, detectedActions, readCodeFile, searchCode, workspaceIdentity } from "../../../src/index.ts";

let root: string;
let outside: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "ancientvoid-code-"));
  outside = mkdtempSync(join(tmpdir(), "ancientvoid-outside-"));
  mkdirSync(join(root, "src"));
  mkdirSync(join(root, "tools"));
  writeFileSync(join(root, "src/auth.ts"), ["import { z } from \"zod\";", "", "// uses parseToken below", "export function parseToken(raw: string): string {", "  return raw.trim();", "}", "", "const x = parseToken(\" a \");", ""].join("\n"));
  writeFileSync(join(root, "tools/check.py"), ["import sys", "", "", "def parse_token(raw):", "    return raw.strip()", "", "print(parse_token(sys.argv[1]))", ""].join("\n"));
  writeFileSync(join(root, "bild.bin"), Buffer.from([0, 1, 2, 3, 0, 5]));
  writeFileSync(join(outside, "geheim.txt"), "nicht zeigen\n");
  symlinkSync(join(outside, "geheim.txt"), join(root, "link.txt"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { test: "node -e \"console.log('gruen')\"" } }));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe("code search (T7.6, AC-P7-6)", () => {
  it("finds a known function in .ts and .py by name, definition first, with the right line", async () => {
    const ts = await searchCode(root, "parseToken", { mode: "symbol" });
    expect(ts.engine).toBe("ripgrep");
    expect(ts.matches[0]).toMatchObject({ path: "src/auth.ts", line: 4, kind: "definition" });
    expect(ts.matches.filter((m) => m.kind === "match").map((m) => m.line)).toEqual([3, 8]);
    const py = await searchCode(root, "parse_token", { mode: "symbol" });
    expect(py.matches[0]).toMatchObject({ path: "tools/check.py", line: 4, column: 5, kind: "definition" });
  });

  it("text search is literal and case-insensitive; excluded dirs stay out", async () => {
    const r = await searchCode(root, "RAW.TRIM(", { mode: "text" });
    expect(r.matches).toEqual([expect.objectContaining({ path: "src/auth.ts", line: 5 })]);
    expect((await searchCode(root, "parse_token", { mode: "text", exclude: ["tools"] })).matches).toEqual([]);
  });

  it("git grep is the fallback without ripgrep — same anchors", async () => {
    const bin = mkdtempSync(join(tmpdir(), "ancientvoid-bin-"));
    symlinkSync(execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim(), join(bin, "git"));
    const path = process.env.PATH;
    process.env.PATH = bin;
    try {
      const r = await searchCode(root, "parse_token", { mode: "symbol" });
      expect(r.engine).toBe("git-grep");
      expect(r.matches[0]).toMatchObject({ path: "tools/check.py", line: 4, kind: "definition" });
    } finally {
      process.env.PATH = path;
      rmSync(bin, { recursive: true, force: true });
    }
  });

  it("symbol mode takes names only; the definition pattern knows the languages", async () => {
    await expect(searchCode(root, "a.b(", { mode: "symbol" })).rejects.toThrow("Namen");
    const re = new RegExp(definitionPattern("run"));
    for (const line of ["export async function run(", "class run {", "def run(self):", "  async run(x: number): Promise<void> {", "func (s *S) run() {", "pub fn run(", "run() {", "const run = () =>"]) expect(re.test(line), line).toBe(true);
    for (const line of ["run(1);", "await this.run()", "# run later"]) expect(re.test(line), line).toBe(false);
  });
});

describe("file viewer (T7.6)", () => {
  it("reads a file with language, line count, blob id and identity", async () => {
    const identity = await workspaceIdentity(root, { id: "s1", base: "abc" });
    expect(identity).toMatchObject({ kind: "session", sessionId: "s1", branch: "main", base: "abc" });
    expect(identity.head).toMatch(/^[0-9a-f]{40}$/);
    const file = await readCodeFile(root, "tools/check.py", identity);
    expect(file).toMatchObject({ path: "tools/check.py", language: "python", lines: 7, binary: false, truncated: false });
    expect(file!.blobSha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("never leaves the root: .., absolute paths, symlinks out, .git — and binaries are not shown", async () => {
    for (const bad of ["../x", "/etc/passwd", "link.txt", ".git/config", "src", "fehlt.ts"]) expect(await containedFile(root, bad), bad).toBeNull();
    const bin = await readCodeFile(root, "bild.bin", await workspaceIdentity(root, null));
    expect(bin).toMatchObject({ binary: true, content: "", language: "binary" });
  });
});

describe("registered actions (T7.6)", () => {
  it("placeholders are checked: no unknown params, no option injection, optional ones drop out", () => {
    const def = ActionDefinition.parse({ id: "t", label: "t", kind: "test", argv: ["pytest", "{path}"], params: { path: { optional: true } } });
    expect(actionArgv(def, {})).toEqual(["pytest"]);
    expect(actionArgv(def, { path: "tests/test_a.py" })).toEqual(["pytest", "tests/test_a.py"]);
    expect(() => actionArgv(def, { path: "--rootdir=/" })).toThrow("ungültig");
    expect(() => actionArgv(def, { path: "a;rm -rf /" })).toThrow("ungültig");
    expect(() => actionArgv(def, { other: "x" })).toThrow("Unbekannter");
  });

  it("detects the project's own test command; git reads are built in and read-only", async () => {
    expect((await detectedActions(root)).map((a) => a.id)).toEqual(["npm-test"]);
    expect(BUILTIN_ACTIONS.every((a) => a.readOnly && a.kind === "git")).toBe(true);
  });

  it("lists every script the repo declares (package.json, Makefile, scripts/), grouped by source, no shell", async () => {
    const repo = mkdtempSync(join(tmpdir(), "ancientvoid-scripts-"));
    try {
      mkdirSync(join(repo, "scripts"));
      writeFileSync(join(repo, "package.json"), JSON.stringify({ scripts: { test: "x", build: "y", "--evil": "z" } }));
      writeFileSync(join(repo, "Makefile"), ".PHONY: all\nall:\n\techo hi\nCC := gcc\nlint:\n\ttrue\n");
      writeFileSync(join(repo, "scripts/deploy.sh"), "#!/bin/sh\n", { mode: 0o755 });
      writeFileSync(join(repo, "scripts/notes.txt"), "kein Skript\n", { mode: 0o644 });
      const found = await detectedActions(repo);
      expect(found.map((a) => [a.source, a.argv.join(" ")])).toEqual([
        ["package.json", "npm test"],
        ["package.json", "npm run build"],
        ["Makefile", "make all"],
        ["Makefile", "make lint"],
        ["scripts/", "./scripts/deploy.sh"],
      ]);
      expect(new Set(found.map((a) => a.id)).size).toBe(found.length);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("runs in the worktree, reports status and output, the same action only once at a time, and puts ≤ 4 KB into the timeline", async () => {
    const events: EmittedEvent[] = [];
    const runner = new ActionRunner({ record: async (_s, e) => void events.push(...e) });
    const ok = await runner.start("s1", root, BUILTIN_ACTIONS[0]!, {}, "handy");
    await expect(runner.start("s1", root, BUILTIN_ACTIONS[0]!, {}, "handy")).rejects.toThrow("läuft schon");
    await waitFor(() => runner.get("s1", ok.id)?.status !== "running");
    expect(runner.get("s1", ok.id)).toMatchObject({ status: "succeeded", exitCode: 0, actor: "handy" });
    expect(runner.get("s1", ok.id)!.output).toContain("## main");

    const fail = ActionDefinition.parse({ id: "f", label: "Fehler", kind: "tool", argv: ["sh", "-c", "yes x | head -c 20000; exit 3"] });
    const r = await runner.start("s1", root, fail, {}, null);
    await waitFor(() => runner.get("s1", r.id)?.status !== "running");
    expect(runner.get("s1", r.id)).toMatchObject({ status: "failed", exitCode: 3 });
    const result = events.filter((e) => e.type === "tool_result").at(-1)!;
    expect(result.payload).toMatchObject({ isError: true, status: "failed", exitCode: 3 });
    expect(JSON.stringify(result.payload).length).toBeLessThan(4096);
    expect(runner.list("s1").map((x) => x.actionId)).toEqual(["f", "git-status"]);
  });

  it("a long-running command has no time limit, runs next to others, and Stop ends the whole process group", async () => {
    const runner = new ActionRunner({ record: async () => undefined });
    const server = ActionDefinition.parse({ id: "srv", label: "Server", kind: "tool", argv: ["sh", "-c", "sleep 30 & sleep 30"], timeoutMs: 100, longRunning: true });
    const r = await runner.start("s3", root, server, {}, null);
    await new Promise((res) => setTimeout(res, 300));
    expect(runner.get("s3", r.id)?.status).toBe("running"); // timeoutMs gilt nicht
    const other = await runner.start("s3", root, BUILTIN_ACTIONS[0]!, {}, null); // parallel erlaubt
    await waitFor(() => runner.get("s3", other.id)?.status !== "running");
    expect(runner.stop("s3", r.id)).toBe(true);
    await waitFor(() => runner.get("s3", r.id)?.status !== "running");
    expect(runner.get("s3", r.id)?.status).toBe("stopped");
    expect(runner.stop("s3", r.id)).toBe(false);
  });

  it("gives tools the desktop variables (window opens on the hub's screen) and CI only to tests", async () => {
    const out: string[] = [];
    const runner = new ActionRunner({ record: async () => undefined });
    const probe = (id: string, kind: "tool" | "test") => ActionDefinition.parse({ id, label: id, kind, argv: ["sh", "-c", 'echo "CI=${CI:-} DISPLAY=${DISPLAY:-}"'] });
    const prevDisplay = process.env.DISPLAY;
    process.env.DISPLAY = ":42";
    try {
      for (const [id, kind] of [["p-tool", "tool"], ["p-test", "test"]] as const) {
        const r = await runner.start("s4", root, probe(id, kind), {}, null);
        await waitFor(() => runner.get("s4", r.id)?.status !== "running");
        out.push(runner.get("s4", r.id)!.output.trim());
      }
    } finally {
      if (prevDisplay === undefined) delete process.env.DISPLAY;
      else process.env.DISPLAY = prevDisplay;
    }
    expect(out).toEqual(["CI= DISPLAY=:42", "CI=1 DISPLAY=:42"]);
  });

  it("derives missing desktop variables from the session runtime dir, never overrides existing ones", () => {
    const runtime = mkdtempSync(join(tmpdir(), "ancientvoid-xdg-"));
    const x11 = mkdtempSync(join(tmpdir(), "ancientvoid-x11-"));
    try {
      writeFileSync(join(runtime, "wayland-1"), "");
      writeFileSync(join(runtime, "wayland-1.lock"), "");
      writeFileSync(join(runtime, "bus"), "");
      writeFileSync(join(x11, "X0"), "");
      expect(desktopEnv({ XDG_RUNTIME_DIR: runtime }, { x11 })).toEqual({ WAYLAND_DISPLAY: "wayland-1", DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(runtime, "bus")}`, DISPLAY: ":0" });
      expect(desktopEnv({ XDG_RUNTIME_DIR: runtime, WAYLAND_DISPLAY: "wayland-9", DISPLAY: ":7", DBUS_SESSION_BUS_ADDRESS: "x" }, { x11 })).toEqual({});
    } finally {
      rmSync(runtime, { recursive: true, force: true });
      rmSync(x11, { recursive: true, force: true });
    }
  });

  it("a timeout ends the whole process group", async () => {
    const runner = new ActionRunner({ record: async () => undefined });
    const slow = ActionDefinition.parse({ id: "slow", label: "Langsam", kind: "tool", argv: ["sh", "-c", "sleep 30 & sleep 30"], timeoutMs: 300 });
    const r = await runner.start("s2", root, slow, {}, null);
    await waitFor(() => runner.get("s2", r.id)?.status !== "running");
    expect(runner.get("s2", r.id)?.status).toBe("timeout");
  });
});

async function waitFor(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}
