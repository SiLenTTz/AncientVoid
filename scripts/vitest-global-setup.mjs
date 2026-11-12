import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertWorkspaceLinks } from "./check-workspace-links.mjs";

/** BUG-0125: vor jedem Vitest-Lauf — im Worktree ohne eigene Links bricht er laut ab (kein stilles Testen von main).
 * BUG-0127: jeder Lauf bekommt einen eigenen qmd-Index; der Live-Index des Hubs bleibt unberührt. */
export default function setup() {
  assertWorkspaceLinks(join(dirname(fileURLToPath(import.meta.url)), ".."));
  const index = (process.env.ANCIENTVOID_QMD_INDEX ??= `ancientvoid-test-${process.pid}`);
  return async () => {
    const base = join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "qmd", `${index}.sqlite`);
    await Promise.all(["", "-wal", "-shm"].map((suffix) => rm(base + suffix, { force: true })));
  };
}
