import { readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import type { GraphDiagFile, GraphDiagSource } from "@ancientvoid/contracts";
import { tscProjectDiagnostics } from "../diagnostics/index.ts";

const JSON_MAX_BYTES = 8 * 1024 * 1024;
const TS_EXT: Record<string, true> = { ".ts": true, ".tsx": true, ".mts": true, ".cts": true, ".js": true, ".jsx": true, ".mjs": true, ".cjs": true };

/**
 * EPIC-P48 (ADR-0062 §4): Diagnose-Überlagerung für den Graph — JSON-Syntax überall,
 * tsc einmal pro tsconfig mit Trust-Gate wie P46. Zustände ehrlich, nie „0 Fehler“
 * ohne gelaufenen Provider; Lint ist nicht eingebunden und wird nicht behauptet.
 */
export async function diagnoseGraph(root: string, paths: readonly string[], opts: { trusted: boolean }): Promise<{ sources: GraphDiagSource[]; byFile: GraphDiagFile[] }> {
  const sources: GraphDiagSource[] = [];
  const byFile = new Map<string, GraphDiagFile>();
  const bump = (path: string, errors: number, warnings: number): void => {
    const cur = byFile.get(path);
    if (cur) {
      cur.errors += errors;
      cur.warnings += warnings;
    } else {
      byFile.set(path, { path, errors, warnings });
    }
  };

  const jsonPaths = paths.filter((p) => {
    const e = extname(p).toLowerCase();
    return e === ".json" || e === ".ipynb";
  });
  if (jsonPaths.length > 0) {
    let failed = 0;
    const notes: string[] = [];
    for (const p of jsonPaths) {
      try {
        if ((await stat(join(root, p))).size > JSON_MAX_BYTES) {
          notes.push(`${p} > 8 MiB`);
          continue;
        }
        JSON.parse(await readFile(join(root, p), "utf8"));
      } catch (err) {
        if (err instanceof SyntaxError) {
          failed++;
          bump(p, 1, 0);
        } else {
          notes.push(`${p} nicht lesbar`);
        }
      }
    }
    sources.push({ name: "JSON.parse", state: failed > 0 ? "errors" : "ok", detail: notes.length > 0 ? notes.slice(0, 5).join(" · ") : null });
  }

  const tsPaths = paths.filter((p) => extname(p).toLowerCase() in TS_EXT);
  if (tsPaths.length > 0) {
    const tsconfigs = paths.filter((p) => {
      const name = p.slice(p.lastIndexOf("/") + 1);
      return name.startsWith("tsconfig") && name.endsWith(".json");
    });
    const res = await tscProjectDiagnostics(root, tsconfigs, { trusted: opts.trusted });
    sources.push(res.source);
    for (const d of res.diagnostics) {
      if (d.severity === "error") bump(d.path, 1, 0);
      else if (d.severity === "warning") bump(d.path, 0, 1);
    }
  }

  if (sources.length === 0) {
    sources.push({ name: "AncientVoid", state: "not_configured", detail: "Keine prüfbaren Dateien im Graph (JSON/tsc). Lint ist nicht eingebunden." });
  }
  return { sources, byFile: [...byFile.values()].sort((a, b) => a.path.localeCompare(b.path)) };
}
