import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertWorkspaceLinks } from "./check-workspace-links.mjs";

/** BUG-0125: vor jedem Vitest-Lauf — im Worktree ohne eigene Links bricht er laut ab (kein stilles Testen von main). */
export default function setup() {
  assertWorkspaceLinks(join(dirname(fileURLToPath(import.meta.url)), ".."));
}
