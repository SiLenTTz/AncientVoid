import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

describe("hub.sh instance identity (ADR-0074)", () => {
  it.each(["foreign-checkout", "foreign-config", "foreign-unit-config", "unknown-env-file", "same-instance", "same-custom-config"])("protects the installed unit: %s", mode => {
    const root = mkdtempSync(join(tmpdir(), "av-hub-instance-"));
    try {
      mkdirSync(join(root, "scripts"));
      mkdirSync(join(root, "bin"));
      copyFileSync(resolve("scripts/hub.sh"), join(root, "scripts/hub.sh"));
      const calls = join(root, "calls");
      writeFileSync(calls, "");
      writeFileSync(join(root, "bin/systemctl"), '#!/bin/bash\nif [ "$2" = cat ]; then exit 0; fi\nif [ "$2" = show ]; then case "$5" in WorkingDirectory) printf "%s\\n" "$AV_UNIT_ROOT";; Environment) printf "%s\\n" "$AV_UNIT_ENV";; EnvironmentFiles) printf "%s\\n" "$AV_UNIT_FILES";; esac; exit 0; fi\nprintf "%s\\n" "$*" >> "$AV_UNIT_CALLS"\n', { mode: 0o755 });
      const custom = mode === "same-custom-config";
      const run = spawnSync("bash", [join(root, "scripts/hub.sh"), "stop"], { encoding: "utf8", env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}`, AV_UNIT_ROOT: mode === "foreign-checkout" ? `${root}/other` : root, AV_UNIT_CALLS: calls, AV_UNIT_ENV: mode === "foreign-unit-config" || custom ? `ANCIENTVOID_CONFIG=${root}/other.json` : "", AV_UNIT_FILES: mode === "unknown-env-file" ? `${root}/runtime.env` : "", ANCIENTVOID_CONFIG: mode === "foreign-config" || custom ? `${root}/other.json` : `${root}/hub.config.json`, HUB_LOCAL: "0" } });
      if (mode === "same-instance" || custom) {
        expect(run.status).toBe(0);
        expect(readFileSync(calls, "utf8")).toContain("--user stop ancientvoid-hub.service");
      } else {
        expect(run.status).toBe(1);
        expect(readFileSync(calls, "utf8")).toBe("");
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
