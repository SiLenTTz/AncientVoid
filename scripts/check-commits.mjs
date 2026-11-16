#!/usr/bin/env node
/**
 * Gate: every commit on this branch (since it left origin/main) follows the
 * commit notation (docs/commit-notation.md). Merge commits are GitHub's and
 * carry the PR title; they are checked by the PR title rule, not here.
 */
import { execFileSync } from "node:child_process";
import { checkSubject } from "./commit-notation.mjs";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
let base;
try {
  base = git("merge-base", "HEAD", "origin/main");
} catch {
  console.log("check:commits — no origin/main to compare with, skipped");
  process.exit(0);
}
const subjects = git("log", "--no-merges", "--format=%s", `${base}..HEAD`).split("\n").filter(Boolean);
const problems = subjects.map(checkSubject).filter(Boolean);
for (const p of problems) console.error(`FAIL: ${p}`);
if (problems.length > 0) process.exit(1);
console.log(`check:commits — ${subjects.length} commit(s) since origin/main follow the notation`);
