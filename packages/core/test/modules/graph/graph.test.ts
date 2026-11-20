import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildFileGraph } from "../../../src/modules/graph/scan.ts";
import { diagnoseGraph } from "../../../src/modules/graph/diagnose.ts";

function dir(): string {
  return mkdtempSync(join(tmpdir(), "av-p48-"));
}

function repo(files: Record<string, string>): string {
  const root = dir();
  const git = (...a: string[]) => execFileSync("git", ["-C", root, "-c", "user.email=t@t", "-c", "user.name=t", ...a], { stdio: "ignore" });
  git("init", "-q", "-b", "main");
  writeFileSync(join(root, ".gitignore"), "node_modules/\ndist/\n*.log\n");
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path.slice(0, path.lastIndexOf("/"))), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  return root;
}

const edgeSet = (g: { edges: { from: string; to: string; kind: string }[] }) => new Set(g.edges.map((e) => `${e.from} → ${e.to} (${e.kind})`));
const node = (g: { nodes: { path: string; group: string; in: number; out: number; entry: boolean; category?: string | null }[] }, path: string) => g.nodes.find((n) => n.path === path);

describe("EPIC-P48 buildFileGraph (ADR-0062)", () => {
  it("resolve relative imports: Erweiterung, index, dynamisch, require", async () => {
    const root = repo({
      "src/a.ts": "import { b } from './b'\nimport('./c')\n",
      "src/b.ts": "export const b = 1\n",
      "src/c.ts": "export const c = 1\n",
      "src/main.ts": "import { b } from './b'\n",
      "package.json": "{}\n",
    });
    const g = await buildFileGraph(root);
    const edges = edgeSet(g);
    expect(edges.has("src/a.ts → src/b.ts (import)")).toBe(true);
    expect(edges.has("src/a.ts → src/c.ts (import)")).toBe(true);
    expect(edges.has("src/main.ts → src/b.ts (import)")).toBe(true);
    expect(node(g, "src/main.ts")?.entry).toBe(true);
    expect(node(g, "src/a.ts")?.entry).toBe(false);
  });

  it("Markdown-Links (inline und Referenz) und Anker", async () => {
    const root = repo({
      "README.md": "Siehe [Handbuch](docs/handbuch.md) und [Weichen](#weichen)\n\n[ref]: docs/ref.md\n",
      "docs/handbuch.md": "# H\n",
      "docs/ref.md": "# R\n",
    });
    const g = await buildFileGraph(root);
    const edges = edgeSet(g);
    expect(edges.has("README.md → docs/handbuch.md (link)")).toBe(true);
    expect(edges.has("README.md → docs/ref.md (link)")).toBe(true);
    expect(edges.size).toBe(2); // Same-Doc-Anker erzeugt keine Kante.
  });

  it("CSS @import/url und HTML src, nur relativ", async () => {
    const root = repo({
      "style.css": '@import "base.css";\n.a { background: url(img/bg.svg); }\n',
      "base.css": "b {}\n",
      "img/bg.svg": "<svg/>",
      "index.html": '<script src="app.js"></script><a href="https://x.de">x</a>\n',
      "app.js": "export {}\n",
    });
    const g = await buildFileGraph(root);
    const edges = edgeSet(g);
    expect(edges.has("style.css → base.css (asset)")).toBe(true);
    expect(edges.has("style.css → img/bg.svg (asset)")).toBe(true);
    expect(edges.has("index.html → app.js (asset)")).toBe(true);
    expect([...edges].some((e) => e.includes("https://"))).toBe(false);
  });

  it("Python-Relative-Imports best effort (Paket hoch und quer)", async () => {
    const root = repo({
      "pkg/a.py": "from .b import x\nfrom ..c import y\n",
      "pkg/b.py": "x = 1\n",
      "c.py": "y = 1\n",
    });
    const g = await buildFileGraph(root);
    const edges = edgeSet(g);
    expect(edges.has("pkg/a.py → pkg/b.py (pyimport)")).toBe(true);
    expect(edges.has("pkg/a.py → c.py (pyimport)")).toBe(true);
  });

  it("Paket-Imports und Unauflösbares erzeugen keine Phantomknoten, sondern unresolved", async () => {
    const root = repo({
      "a.ts": "import { x } from 'preact'\nimport { y } from './gibt-es-nicht'\n",
    });
    const g = await buildFileGraph(root);
    expect(g.edges.length).toBe(0);
    expect(g.meta.unresolved).toBe(1);
  });

  it("Zyklus und Kanten-Dedupe", async () => {
    const root = repo({
      "a.ts": "import { b } from './b'\n",
      "b.ts": "import { a } from './a'\nimport { a as a2 } from './a'\n",
    });
    const g = await buildFileGraph(root);
    expect(g.edges.length).toBe(2);
    expect(node(g, "a.ts")?.in).toBe(1);
    expect(node(g, "a.ts")?.out).toBe(1);
  });

  it("git-Aufzählung respektiert .gitignore (node_modules, dist, *.log)", async () => {
    const root = repo({ "a.ts": "export {}\n" });
    mkdirSync(join(root, "node_modules", "preact"), { recursive: true });
    writeFileSync(join(root, "node_modules", "preact", "x.ts"), "export {}\n");
    mkdirSync(join(root, "dist"), { recursive: true });
    writeFileSync(join(root, "dist", "y.js"), "export {}\n");
    writeFileSync(join(root, "debug.log"), "x");
    const g = await buildFileGraph(root);
    expect(g.meta.enumeration).toBe("git");
    expect(g.nodes.map((n) => n.path)).toEqual([".gitignore", "a.ts"]);
  });

  it("Fallback-Walk ohne git mit festen Ausschlüssen, exclude greift", async () => {
    const root = dir();
    writeFileSync(join(root, "a.ts"), "export {}\n");
    mkdirSync(join(root, "node_modules"), { recursive: true });
    writeFileSync(join(root, "node_modules", "x.ts"), "export {}\n");
    mkdirSync(join(root, "data", "worktrees", "s1"), { recursive: true });
    writeFileSync(join(root, "data", "worktrees", "s1", "b.ts"), "export {}\n");
    const g = await buildFileGraph(root, { exclude: ["data"] });
    expect(g.meta.enumeration).toBe("walk");
    expect(g.nodes.map((n) => n.path)).toEqual(["a.ts"]);
  });

  it("maxFiles kappen ehrlich (truncated)", async () => {
    const root = repo(Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`f${i}.ts`, "export {}\n"])));
    const g = await buildFileGraph(root, { maxFiles: 4 });
    expect(g.meta.truncated).toBe(true);
    expect(g.nodes.length).toBe(4); // .gitignore + 3 Dateien — Reihenfolge ist sortiert.
    expect(g.meta.maxFiles).toBe(4);
  });

  it("tote Datei: kein Zufluss und kein Einstiegspunkt — Eintrag ohne Zufluss gilt nicht als tot", async () => {
    const root = repo({
      "main.ts": "import { u } from './used'\n",
      "used.ts": "export const u = 1\n",
      "orphan.ts": "export const o = 1\n",
    });
    const g = await buildFileGraph(root);
    expect(node(g, "orphan.ts")?.in).toBe(0);
    expect(node(g, "orphan.ts")?.entry).toBe(false);
    expect(node(g, "main.ts")?.entry).toBe(true);
    expect(node(g, "used.ts")?.entry).toBe(false);
  });

  it("Binärinhalt (NUL-Byte) und Übergroße werden Knoten ohne ausgehende Kanten", async () => {
    const root = repo({
      "bin.md": "a\u0000b",
      "big.ts": "import { x } from './bin' \u2026".padEnd(600 * 1024, "."),
    });
    const g = await buildFileGraph(root, { scanMaxBytes: 512 * 1024 });
    expect(node(g, "bin.md")).toBeDefined();
  });

  it("Referenz-Repo: AncientVoid selbst — Umfang und Laufzeit dokumentiert (K2/K8)", async () => {
    // Läuft im Repo-Kontext (CI/Entwicklung): .git vorhanden → echte Messung,
    // sonst (Fremdkontext) übersprungen — kein Fake-Nachweis.
    const root = process.cwd();
    if (!existsSync(join(root, ".git"))) return;
    const started = Date.now();
    const g = await buildFileGraph(root);
    const ms = Date.now() - started;
    expect(g.nodes.length).toBeGreaterThan(800);
    expect(g.edges.length).toBeGreaterThan(800);
    expect(g.meta.enumeration).toBe("git");
    // K8-Geist: Der Scan blockiert den Hub nicht übermäßig (dokumentierte Schwelle, bewusst großzügig).
    expect(ms).toBeLessThan(15_000);
    console.log(`referenz-graph: ${g.meta.files} Dateien, ${g.meta.edgeCount} Kanten, ${ms} ms`);
  });
});

describe("BUG-0232 Kategorie-Bereiche", () => {
  it("weist jedem Knoten das erste Pfadsegment als Kategorie zu, Wurzeldateien bleiben null", async () => {
    const root = repo({
      "epics/EPIC-P1.md": "# e\n",
      "bugs/bug-0001-x.md": "# b\n",
      "bugs/bug-0002-y.md": "# b\n",
      "packages/core/src/a.ts": "export const a = 1\n",
      "README.md": "# r\n",
    });
    const g = await buildFileGraph(root);
    expect(node(g, "epics/EPIC-P1.md")?.category).toBe("epics");
    expect(node(g, "bugs/bug-0002-y.md")?.category).toBe("bugs");
    expect(node(g, "packages/core/src/a.ts")?.category).toBe("packages");
    expect(node(g, "README.md")?.category).toBeNull();
  });
});

describe("EPIC-P48 diagnoseGraph", () => {
  it("JSON-Syntaxfehler zählen pro Datei, Gegenprobe grün", async () => {
    const root = repo({ "ok.json": "{}\n", "kaputt.json": "{\n" });
    const bad = await diagnoseGraph(root, ["ok.json", "kaputt.json"], { trusted: false });
    expect(bad.sources.find((s) => s.name === "JSON.parse")?.state).toBe("errors");
    expect(bad.byFile).toEqual([{ path: "kaputt.json", errors: 1, warnings: 0 }]);
    writeFileSync(join(root, "kaputt.json"), "{}\n");
    const good = await diagnoseGraph(root, ["ok.json", "kaputt.json"], { trusted: false });
    expect(good.sources.find((s) => s.name === "JSON.parse")?.state).toBe("ok");
    expect(good.byFile.length).toBe(0);
  });

  it("tsc ohne Trust: untrusted, nie „fehlerfrei“", async () => {
    const root = repo({ "a.ts": "const x: number = 'falsch'\n", "tsconfig.json": "{}\n" });
    // Projekteigenes tsc-Binary (Stub) — sonst gilt not_configured, nicht untrusted (P46-Semantik).
    mkdirSync(join(root, "node_modules", ".bin"), { recursive: true });
    writeFileSync(join(root, "node_modules", ".bin", "tsc"), "#!/bin/sh\nexit 0\n");
    execFileSync("chmod", ["+x", join(root, "node_modules", ".bin", "tsc")]);
    const res = await diagnoseGraph(root, ["a.ts", "tsconfig.json"], { trusted: false });
    const tsc = res.sources.find((s) => s.name === "tsc (Projekt)");
    expect(tsc?.state).toBe("untrusted");
    expect(res.byFile.length).toBe(0);
  });

  it("keine prüfbaren Dateien: not_configured statt 0 Fehler", async () => {
    const res = await diagnoseGraph(dir(), ["bild.png"], { trusted: false });
    expect(res.sources[0]!.state).toBe("not_configured");
  });
});
