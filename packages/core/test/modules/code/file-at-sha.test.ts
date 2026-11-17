import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCodeFileAt } from "../../../src/modules/code/file.ts";

function git(cwd: string, args: string[]) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

describe("readCodeFileAt (BUG-0191)", () => {
  it("liest den Blob einer alten Revision und auch nach Löschung", async () => {
    const root = mkdtempSync(join(tmpdir(), "av-blob-"));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src/note.txt"), "stand-eins\n");
    git(root, ["init", "-q", "-b", "main"]);
    git(root, ["add", "-A"]);
    git(root, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "add note"]);
    const addSha = git(root, ["rev-parse", "HEAD"]);

    writeFileSync(join(root, "src/note.txt"), "stand-zwei\n");
    git(root, ["add", "-A"]);
    git(root, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "change note"]);

    execFileSync("git", ["-C", root, "rm", "-q", "src/note.txt"]);
    git(root, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "delete note"]);
    const delSha = git(root, ["rev-parse", "HEAD"]);

    const id = { kind: "project" as const, sessionId: null, root, branch: "main", head: delSha, base: null };

    const old = await readCodeFileAt(root, "src/note.txt", addSha, id);
    expect(old?.content).toBe("stand-eins\n");

    // Datei fehlt im Worktree — Lösch-Commit liefert Parent-Inhalt
    const gone = await readCodeFileAt(root, "src/note.txt", delSha, id);
    expect(gone?.content).toBe("stand-zwei\n");

    expect(await readCodeFileAt(root, "../etc/passwd", addSha, id)).toBeNull();
    expect(await readCodeFileAt(root, "src/note.txt", "notasha", id)).toBeNull();
  });
});
