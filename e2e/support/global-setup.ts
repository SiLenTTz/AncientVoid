import { execFileSync } from "node:child_process";
import { repoRoot } from "./hub.ts";

/** The hub serves packages/pwa/dist — build it fresh so the gate never
 * tests a stale bundle. */
export default function globalSetup(): void {
  execFileSync("npm", ["-w", "@uacc/pwa", "run", "build"], { cwd: repoRoot, stdio: "inherit" });
}
