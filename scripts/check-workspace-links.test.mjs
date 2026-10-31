import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { misplacedWorkspaces } from "./check-workspace-links.mjs";

function checkout(root, linked) {
  mkdirSync(join(root, "packages", "core"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ workspaces: ["packages/*"] }));
  writeFileSync(join(root, "packages", "core", "package.json"), JSON.stringify({ name: "@ancientvoid/core" }));
  if (linked) {
    mkdirSync(join(root, "node_modules", "@ancientvoid"), { recursive: true });
    symlinkSync("../../packages/core", join(root, "node_modules", "@ancientvoid", "core"));
  }
}

describe("check:workspace-links (BUG-0069)", () => {
  it("ein Worktree ohne eigene Links unter dem Haupt-Checkout wird erkannt", () => {
    const main = mkdtempSync(join(tmpdir(), "ancientvoid-links-"));
    checkout(main, true);
    const worktree = join(main, "data", "worktrees", "s1");
    checkout(worktree, false);
    expect(misplacedWorkspaces(main)).toEqual([]);
    expect(misplacedWorkspaces(worktree)).toEqual([expect.objectContaining({ name: "@ancientvoid/core", expected: join(worktree, "packages", "core") })]);
  });

  it("mit eigenen Links ist der Worktree in Ordnung", () => {
    const main = mkdtempSync(join(tmpdir(), "ancientvoid-links-"));
    checkout(main, true);
    const worktree = join(main, "data", "worktrees", "s2");
    checkout(worktree, true);
    expect(misplacedWorkspaces(worktree)).toEqual([]);
  });
});

describe("check:workspace-links --fix", () => {
  it("setzt die Links auf den Worktree", async () => {
    const { linkWorkspaces } = await import("./check-workspace-links.mjs");
    const main = mkdtempSync(join(tmpdir(), "ancientvoid-links-"));
    checkout(main, true);
    const worktree = join(main, "data", "worktrees", "s3");
    checkout(worktree, false);
    linkWorkspaces(worktree, misplacedWorkspaces(worktree));
    expect(misplacedWorkspaces(worktree)).toEqual([]);
  });
});
