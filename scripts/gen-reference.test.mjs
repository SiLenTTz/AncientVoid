import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { renderWizard, renderHubctl, flatten, renderConfig } from "./gen-reference.mjs";

const SCRIPT = `#!/usr/bin/env bash
# Kopf.
#
# Flags:  --yes                keine Rückfragen
#         --port=<n>           Port
# Exit:   0 ok · 2 Voraussetzung fehlt
#         oder ungültig · 6 Port belegt
set -e
`;

describe("gen-reference — reine Renderer", () => {
  it("Wizard: Flags bleiben eingerückt, Exit-Codes werden Tabelle (auch über Zeilenumbruch)", () => {
    const md = renderWizard(SCRIPT);
    expect(md).toContain("**Art:** referenz");
    expect(md).toContain("--yes                keine Rückfragen\n--port=<n>           Port");
    expect(md).toContain("| 2 | Voraussetzung fehlt oder ungültig |");
    expect(md).toContain("| 6 | Port belegt |");
  });
  it("Wizard ohne Exit-Block scheitert laut", () => {
    expect(() => renderWizard("# nur Kopf\n")).toThrow(/Flags:\/Exit:/);
  });
  it("Config: verschachtelte Felder werden Pfade mit Typ und Default", () => {
    const rows = flatten({ properties: { a: { type: "string", default: "x" }, srv: { type: "object", properties: { port: { type: "integer", default: 7 }, m: { enum: ["a", "b"] } } } } });
    expect(rows.map((r) => `${r.path}:${r.type}:${r.def}`)).toEqual(['a:string:"x"', "srv.port:integer:7", 'srv.m:"a" \\| "b":—']);
    expect(renderConfig({ properties: {} })).toContain("| Feld | Typ | Default |");
  });
  it("hubctl: usage kommt unverändert in den Codeblock", () => {
    expect(renderHubctl("Usage:\n  hubctl health\n")).toContain("```text\nUsage:\n  hubctl health\n```");
  });
});

describe("gen-reference — --check gegen das echte Repo", () => {
  it("committeter Stand ist frisch", () => {
    const root = join(import.meta.dirname, "..");
    expect(execFileSync("node", ["scripts/gen-reference.mjs", "--check"], { cwd: root, encoding: "utf8" })).toContain("frisch");
  });
});
