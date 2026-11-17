import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { execFileSync } from "node:child_process";

/** Identitaet des Buendels einmal beim Laden der Konfiguration — version.json fuer den
 * Server und `__BUILD_SHA__` fuer die App muessen dieselbe Antwort meinen, sonst ist ein
 * „welcher Stand laeuft auf dem Geraet?“-Vergleich wertlos. */
function gitIdentity(): { sha: string | null; dirty: boolean | null } {
  try {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().length > 0;
    return { sha, dirty };
  } catch {
    /* Source-Archiven melden ehrlich unbekannte Revision. */
    return { sha: null, dirty: null };
  }
}

const identity = gitIdentity();

export default defineConfig({
  // Die App traegt ihren eigenen Build-Stempel: nur so ist von aussen (Hub-Protokoll)
  // entscheidbar, welches Buendel auf einem Geraet wirklich laeuft — ein Cache auf dem
  // Geraet kann aelter sein als alles, was der Server ausliefert.
  define: { __BUILD_SHA__: JSON.stringify(identity.sha ?? "unbekannt") },
  plugins: [preact(), {
    name: "deployment-identity",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ sha: identity.sha, dirty: identity.dirty, builtAt: new Date().toISOString() }) });
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
