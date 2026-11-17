import { execFileSync } from "node:child_process";
import { repoRoot } from "./hub.ts";
import { winShell } from "./win-shell.ts";

/** The hub serves `apps/pwa/dist-e2e` — build it fresh so the gate never
 * tests a stale bundle. BUG-0183: der Zielordner ist E2E-eigen, `apps/pwa/dist`
 * bleibt unberührt — das ist der Ordner, den der laufende Hub am Handy servt.
 * Auf Windows verbietet Node das Spawnen von `npm` (`.cmd`) ohne Shell —
 * EINVAL/ENOENT — damit war das E2E-Gate auf Windows nicht ausführbar (BUG-0169).
 * Dasselbe Muster gilt fuer den Site-Bau in `e2e/specs/site.spec.ts`; beide teilen
 * `e2e/support/win-shell.ts`. */

export default function globalSetup(): void {
  // Die Argumente sind feste Konstanten (kein Nutzereingang), deshalb ist `shell`
  // hier vertretbar; Node warnt sonst vor DEP0190.
  execFileSync("npm", ["-w", "@ancientvoid/pwa", "run", "build", "--", "--outDir", "dist-e2e", "--emptyOutDir"], { cwd: repoRoot, stdio: "inherit", shell: winShell });
}
