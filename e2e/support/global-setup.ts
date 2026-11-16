import { execFileSync } from "node:child_process";
import { repoRoot } from "./hub.ts";

/** The hub serves apps/pwa/dist — build it fresh so the gate never
 * tests a stale bundle. Auf Windows verbietet Node das Spawnen von `npm`
 * (`.cmd`) ohne Shell — EINVAL/ENOENT — damit war das E2E-Gate auf Windows
 * nicht ausführbar (BUG-0166). */
const needsShell = process.platform === "win32";

export default function globalSetup(): void {
  // Die Argumente sind feste Konstanten (kein Nutzereingang), deshalb ist `shell`
  // hier vertretbar; Node warnt sonst vor DEP0190.
  execFileSync("npm", ["-w", "@ancientvoid/pwa", "run", "build"], { cwd: repoRoot, stdio: "inherit", shell: needsShell });
}
