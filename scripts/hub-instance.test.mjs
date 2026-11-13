import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

describe("hub.sh instance identity (ADR-0074)", () => {
  it.each(["foreign-checkout", "foreign-config", "same-instance"])("protects the installed unit: %s", mode => {
    const root = mkdtempSync(join(tmpdir(), "av-hub-instance-"));
    try {
      mkdirSync(join(root, "scripts"));
      mkdirSync(join(root, "bin"));
      copyFileSync(resolve("scripts/hub.sh"), join(root, "scripts/hub.sh"));
      const calls = join(root, "calls");
      writeFileSync(calls, "");
      writeFileSync(join(root, "bin/systemctl"), '#!/bin/bash\nif [ "$2" = cat ]; then exit 0; fi\nif [ "$2" = show ]; then printf "%s\\n" "$AV_UNIT_ROOT"; exit 0; fi\nprintf "%s\\n" "$*" >> "$AV_UNIT_CALLS"\n', { mode: 0o755 });
      const run = spawnSync("bash", [join(root, "scripts/hub.sh"), "stop"], { encoding: "utf8", env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}`, AV_UNIT_ROOT: mode === "foreign-checkout" ? `${root}/other` : root, AV_UNIT_CALLS: calls, ...(mode === "foreign-config" ? { ANCIENTVOID_CONFIG: `${root}/other.json` } : { ANCIENTVOID_CONFIG: `${root}/hub.config.json` }), HUB_LOCAL: "0" } });
      if (mode === "same-instance") {
        expect(run.status).toBe(0);
        expect(readFileSync(calls, "utf8")).toContain("--user stop ancientvoid-hub.service");
      } else {
        expect(run.status).toBe(1);
        expect(readFileSync(calls, "utf8")).toBe("");
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
