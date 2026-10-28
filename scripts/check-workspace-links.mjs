#!/usr/bin/env node
/**
 * BUG-0069: a hub session worktree lives under <main-checkout>/data/worktrees/,
 * so without its own node_modules every `@uacc/*` import resolves upward to
 * the MAIN checkout's packages — the gate then tests main's code and goes
 * green on changes it never loaded. Fail loud before any test runs.
 *
 *   npm run check:workspace-links
 *   node scripts/check-workspace-links.mjs --fix   (links node_modules/@uacc/*
 *     to this checkout; third-party deps keep resolving upward)
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/** Same lookup Node does: the first node_modules/<name> walking upward,
 * symlink resolved. Works for packages without an entry point too. */
function lookup(from, name) {
  for (let at = from; ; at = dirname(at)) {
    const candidate = join(at, "node_modules", name);
    if (existsSync(candidate)) return realpathSync(candidate);
    if (dirname(at) === at) return null;
  }
}

/** Point node_modules/<name> of `root` at its own package directories. */
export function linkWorkspaces(root, wrong) {
  for (const w of wrong) {
    const link = join(root, "node_modules", w.name);
    mkdirSync(dirname(link), { recursive: true });
    rmSync(link, { force: true, recursive: false });
    symlinkSync(relative(dirname(link), w.expected), link);
  }
}

/** Workspace packages of `root` that would load from somewhere else. */
export function misplacedWorkspaces(root) {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const dirs = (pkg.workspaces ?? []).flatMap((pattern) => {
    if (!pattern.endsWith("/*")) return [join(root, pattern)];
    const base = join(root, pattern.slice(0, -2));
    if (!existsSync(base)) return [];
    return readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => join(base, d.name));
  });
  const wrong = [];
  for (const dir of dirs) {
    const file = join(dir, "package.json");
    if (!existsSync(file)) continue;
    const { name } = JSON.parse(readFileSync(file, "utf8"));
    if (!name?.startsWith("@uacc/")) continue;
    const resolved = lookup(root, name);
    if (resolved !== realpathSync(dir)) wrong.push({ name, resolved, expected: dir });
  }
  return wrong;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  let wrong = misplacedWorkspaces(root);
  if (wrong.length > 0 && process.argv.includes("--fix")) {
    linkWorkspaces(root, wrong);
    console.log(`check:workspace-links: ${wrong.length} Link(s) auf diesen Checkout gesetzt`);
    wrong = misplacedWorkspaces(root);
  }
  if (wrong.length > 0) {
    console.error(`check:workspace-links: ${wrong.length} Workspace-Paket(e) laden nicht aus diesem Checkout (${root}):`);
    for (const w of wrong) console.error(`  ${w.name}: ${w.resolved ?? "nicht gefunden"} (erwartet ${w.expected})`);
    console.error("\nIm Session-Worktree: `node scripts/check-workspace-links.mjs --fix` setzt node_modules/@uacc/* auf diesen Checkout (BUG-0069).");
    process.exit(1);
  }
  console.log(`check:workspace-links: alle @uacc/*-Pakete aus ${root}`);
}
