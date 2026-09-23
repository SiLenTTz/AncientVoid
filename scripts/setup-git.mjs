#!/usr/bin/env node
/**
 * `npm install` (prepare): commit-msg hook and commit template of this repo
 * (docs/commit-notation.md). A copy without .git (git archive, fleet-deploy)
 * has nothing to set up.
 */
import { execFileSync } from "node:child_process";

try {
  execFileSync("git", ["rev-parse", "--git-dir"], { stdio: "ignore" });
} catch {
  process.exit(0);
}
execFileSync("git", ["config", "core.hooksPath", ".githooks"]);
execFileSync("git", ["config", "commit.template", ".gitmessage"]);
