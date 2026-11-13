import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deploymentIdentity } from "../../../src/modules/system/deployment.ts";

it("keeps the loaded revision distinct from a newer checkout and browser build", () => {
  const root = mkdtempSync(join(tmpdir(), "av-deployment-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  try {
    git("init", "-q");
    const commit = (text: string) => {
      writeFileSync(join(root, "source"), text);
      git("add", "source");
      git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", text);
      return git("rev-parse", "HEAD");
    };
    const first = commit("first");
    const pwa = join(root, "dist");
    mkdirSync(pwa);
    writeFileSync(join(pwa, "version.json"), JSON.stringify({ sha: first, dirty: false, builtAt: new Date().toISOString() }));
    const running = deploymentIdentity(root, pwa);
    expect(running()).toMatchObject({ runtimeSha: first, checkoutSha: first, pwaSha: first, consistent: true });
    const second = commit("second");
    const oldRuntime = deploymentIdentity(root, pwa);
    expect(oldRuntime()).toMatchObject({ runtimeSha: second, checkoutSha: second, pwaSha: first, consistent: false });
    writeFileSync(join(pwa, "version.json"), JSON.stringify({ sha: second, dirty: false }));
    expect(running().runtimeSha).toBe(first);
    expect(deploymentIdentity(root, pwa)()).toMatchObject({ runtimeSha: second, pwaSha: second, consistent: true });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

describe("missing deployment metadata", () => {
  it("never presents an unknown build as current", () => {
    const root = mkdtempSync(join(tmpdir(), "av-version-missing-"));
    try { expect(deploymentIdentity(root, root)()).toMatchObject({ runtimeSha: null, checkoutSha: null, pwaSha: null, consistent: null }); }
    finally { rmSync(root, { recursive: true, force: true }); }
  });
});
