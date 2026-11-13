import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { execFileSync } from "node:child_process";

export default defineConfig({
  plugins: [preact(), {
    name: "deployment-identity",
    generateBundle() {
      let sha: string | null = null;
      let dirty: boolean | null = null;
      try {
        sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
        dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().length > 0;
      }
      catch { /* Source archives honestly report an unknown revision. */ }
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ sha, dirty, builtAt: new Date().toISOString() }) });
    },
  }],
  server: {
    proxy: {
      "/api": {
        target: process.env.ANCIENTVOID_PROXY ?? "http://127.0.0.1:7373",
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
