import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DeploymentIdentity } from "@ancientvoid/contracts";

function revision(root: string): string | null {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
}

function dirty(root: string): boolean | null {
  try { return execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().length > 0; }
  catch { return null; }
}

/** Runtime identity is captured once, not silently changed by a later pull. */
export function deploymentIdentity(root: string, pwaDir?: string): () => DeploymentIdentity {
  const runtimeSha = revision(root);
  const runtimeDirty = dirty(root);
  let checkoutSha = runtimeSha;
  let checkoutDirty = runtimeDirty;
  let checkedAt = 0;
  return () => {
    if (Date.now() - checkedAt > 5000) { checkoutSha = revision(root); checkoutDirty = dirty(root); checkedAt = Date.now(); }
    let pwaSha: string | null = null;
    let builtAt: string | null = null;
    let pwaDirty: boolean | null = null;
    if (pwaDir) {
      try {
        const manifest = JSON.parse(readFileSync(resolve(pwaDir, "version.json"), "utf8")) as { sha?: unknown; builtAt?: unknown; dirty?: unknown };
        if (typeof manifest.sha === "string" && /^[a-f0-9]{40}$/.test(manifest.sha)) pwaSha = manifest.sha;
        if (typeof manifest.builtAt === "string") builtAt = manifest.builtAt;
        if (typeof manifest.dirty === "boolean") pwaDirty = manifest.dirty;
      } catch { /* A missing manifest is explicitly unknown, never a matched build. */ }
    }
    const known = runtimeSha && checkoutSha && pwaSha && runtimeDirty !== null && checkoutDirty !== null && pwaDirty !== null;
    return { runtimeSha, checkoutSha, pwaSha, builtAt, runtimeDirty, checkoutDirty, pwaDirty, consistent: known ? runtimeSha === checkoutSha && pwaSha === checkoutSha && !runtimeDirty && !checkoutDirty && !pwaDirty : null };
  };
}
