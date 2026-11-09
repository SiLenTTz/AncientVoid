import { execFile } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { Diagnostic, DiagnosticsResult } from "@ancientvoid/contracts";
import { languageOf, resolveFile } from "../code/index.ts";

const run = promisify(execFile);
const MAX_DIAGS = 500;
const JSON_MAX_BYTES = 8 * 1024 * 1024;
const PY_MAX_BYTES = 5 * 1024 * 1024;
const TSC_TIMEOUT_MS = 120_000;
const TS_EXT = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);

export interface DiagnosticsOptions {
  /** Ob der Mensch dieses Projekt für Prüfer freigegeben hat, die Projektcode starten (tsc aus node_modules). */
  trusted: boolean;
}

const base = (path: string, revision: string, language: string, started: number): Pick<DiagnosticsResult, "path" | "revision" | "language" | "checkedAt" | "durationMs" | "otherFiles" | "truncated"> => ({
  path,
  revision,
  language,
  checkedAt: new Date().toISOString(),
  durationMs: Date.now() - started,
  otherFiles: 0,
  truncated: false,
});

/** Stringindex (UTF-16-Einheit) → 1-basierte Zeile/Spalte; CRLF bleibt Teil der Vorzeile, Emoji zählen 2 Einheiten. */
export function lineColumnAt(text: string, index: number): { line: number; column: number } {
  const before = text.slice(0, Math.min(index, text.length));
  const nl = before.lastIndexOf("\n");
  return { line: (before.match(/\n/g)?.length ?? 0) + 1, column: before.length - (nl + 1) + 1 };
}

/** Python meldet Spalten in Codepoints; der Viewer rechnet in UTF-16-Einheiten. */
export function codepointToUtf16Column(lineText: string, codepointColumn: number): number {
  let units = 0;
  let cp = 0;
  for (const ch of lineText) {
    if (cp >= codepointColumn - 1) break;
    units += ch.length;
    cp++;
  }
  return units + 1;
}

async function jsonDiagnostics(real: string, size: number): Promise<{ diagnostics: Diagnostic[]; ok: boolean } | "too_large"> {
  if (size > JSON_MAX_BYTES) return "too_large";
  const text = (await readFile(real, "utf8")).replace(/^\uFEFF/, "");
  try {
    JSON.parse(text);
    return { diagnostics: [], ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const pos = /position (\d+)/.exec(message);
    const lc = /line (\d+) column (\d+)/.exec(message);
    const at = pos ? lineColumnAt(text, Number(pos[1])) : lc ? { line: Number(lc[1]), column: Number(lc[2]) } : { line: 1, column: 1 };
    return { ok: false, diagnostics: [{ path: "", line: at.line, column: at.column, endLine: null, endColumn: null, severity: "error", code: null, message: message.replace(/\s+\(line \d+ column \d+\)/, ""), source: "JSON.parse" }] };
  }
}

const PY_AST = [
  "import ast, json, sys",
  "p = sys.argv[1]",
  "try:",
  "    ast.parse(open(p, 'rb').read(), p)",
  "    print(json.dumps({'ok': True}))",
  "except SyntaxError as e:",
  "    print(json.dumps({'ok': False, 'line': e.lineno or 1, 'offset': e.offset or 1, 'msg': e.msg}))",
  "except Exception as e:",
  "    print(json.dumps({'ok': False, 'line': 1, 'offset': 1, 'msg': str(e)}))",
].join("\n");

async function pythonDiagnostics(real: string, size: number): Promise<{ diagnostics: Diagnostic[]; ok: boolean } | "too_large" | { failed: string }> {
  if (size > PY_MAX_BYTES) return "too_large";
  let out: string;
  try {
    // -I: isolierter Modus (kein Projekt-sys.path, keine Umgebung); nur ast.parse — es wird nichts importiert oder ausgeführt.
    out = (await run("python3", ["-I", "-c", PY_AST, real], { timeout: 20_000, maxBuffer: 1024 * 1024 })).stdout;
  } catch (err) {
    return { failed: `python3 nicht ausführbar: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}` };
  }
  const res = JSON.parse(out) as { ok: boolean; line?: number; offset?: number; msg?: string };
  if (res.ok) return { diagnostics: [], ok: true };
  const lines = (await readFile(real, "utf8").catch(() => "")).split("\n");
  const lineText = (lines[(res.line ?? 1) - 1] ?? "").replace(/\r$/, "");
  return {
    ok: false,
    diagnostics: [{ path: "", line: res.line ?? 1, column: codepointToUtf16Column(lineText, res.offset ?? 1), endLine: null, endColumn: null, severity: "error", code: null, message: res.msg ?? "SyntaxError", source: "Python ast" }],
  };
}

async function findUp(from: string, root: string, rel: string): Promise<string | null> {
  let dir = from;
  for (;;) {
    const candidate = join(dir, rel);
    if (await stat(candidate).then(() => true, () => false)) return candidate;
    if (dir === root || dirname(dir) === dir) return null;
    dir = dirname(dir);
  }
}

const tscLocks = new Map<string, Promise<unknown>>();
const TSC_LINE = /^(.+?)\((\d+),(\d+)\): (error|warning|info) (TS\d+): (.*)$/;

/** tsc-Ausgabe → Diagnosen je Datei (Pfade relativ zur Root) + Liste der im Programm enthaltenen Dateien. */
export function parseTsc(output: string, cwd: string, realRoot: string): { all: Diagnostic[]; files: Set<string> } {
  const all: Diagnostic[] = [];
  const files = new Set<string>();
  let last: Diagnostic | null = null;
  for (const raw of output.split("\n")) {
    const line = raw.replace(/\r$/, "");
    const m = TSC_LINE.exec(line);
    if (m) {
      last = {
        path: relative(realRoot, resolve(cwd, m[1]!)).split(sep).join("/"),
        line: Number(m[2]),
        column: Number(m[3]),
        endLine: null,
        endColumn: null,
        severity: m[4] as Diagnostic["severity"],
        code: m[5]!,
        message: m[6]!,
        source: "tsc (Projekt)",
      };
      all.push(last);
    } else if (/^\s+\S/.test(line) && last) {
      last.message = `${last.message}\n${line.trim()}`.slice(0, 2000);
    } else if (line.startsWith("/")) {
      files.add(line.trim());
      last = null;
    } else {
      last = null;
    }
  }
  return { all, files };
}

async function tscDiagnostics(root: string, realFile: string, relPath: string, opts: DiagnosticsOptions): Promise<Partial<DiagnosticsResult> & { state: DiagnosticsResult["state"] }> {
  const realRoot = await realpath(root);
  const dir = dirname(realFile);
  const tsconfig = await findUp(dir, realRoot, "tsconfig.json");
  if (!tsconfig) return { state: "not_configured", detail: "Kein tsconfig.json im Projekt — AncientVoid rät keine Compiler-Optionen." };
  const bin = await findUp(dirname(tsconfig), realRoot, join("node_modules", ".bin", "tsc"));
  if (!bin) return { state: "not_configured", detail: "Das Projekt hat kein lokales TypeScript (node_modules/.bin/tsc); AncientVoid installiert nichts nach." };
  if (!opts.trusted) return { state: "untrusted", provider: "tsc (Projekt)", scope: "types", detail: "Projekt nicht freigegeben: tsc stammt aus dem Projekt und wird erst nach ausdrücklicher Freigabe gestartet." };
  const cwd = dirname(tsconfig);
  const prior = tscLocks.get(tsconfig) ?? Promise.resolve();
  const job = prior.catch(() => undefined).then(async () => {
    let stdout = "";
    let timedOut = false;
    try {
      stdout = (await run(bin, ["--noEmit", "--pretty", "false", "--listFiles", "-p", tsconfig], {
        cwd,
        timeout: TSC_TIMEOUT_MS,
        maxBuffer: 64 * 1024 * 1024,
        env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", LANG: "C.UTF-8", NODE_OPTIONS: "--max-old-space-size=2048" },
      })).stdout;
    } catch (err) {
      const failure = err as { stdout?: string; killed?: boolean; code?: unknown; signal?: string };
      if (failure.killed || failure.signal === "SIGTERM") timedOut = true;
      else if (typeof failure.stdout === "string" && failure.stdout !== "") stdout = failure.stdout;
      else return { state: "failed" as const, provider: "tsc (Projekt)", scope: "types" as const, detail: `tsc nicht ausführbar: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}` };
    }
    if (timedOut) return { state: "timeout" as const, provider: "tsc (Projekt)", scope: "types" as const, detail: `tsc brauchte länger als ${TSC_TIMEOUT_MS / 1000} s — kein Ergebnis.` };
    const parsed = parseTsc(stdout, cwd, realRoot);
    const covered = parsed.files.has(realFile) || [...parsed.files].some((f) => f === realFile);
    const mine = parsed.all.filter((d) => d.path === relPath);
    const hasErrors = parsed.all.some((d) => d.severity === "error");
    if (!covered && mine.length === 0) {
      return { state: "not_configured" as const, provider: "tsc (Projekt)", scope: "types" as const, detail: "Die Datei gehört nicht zum Programm dieser tsconfig (include/exclude, allowJs) — keine Aussage über sie.", otherFiles: parsed.all.length };
    }
    return {
      state: mine.some((d) => d.severity === "error") ? ("errors" as const) : ("ok" as const),
      provider: "tsc (Projekt)",
      scope: "types" as const,
      detail: hasErrors && mine.length === 0 ? `Diese Datei ist fehlerfrei; das Projekt hat ${parsed.all.length} Meldung(en) in anderen Dateien.` : null,
      diagnostics: mine.slice(0, MAX_DIAGS),
      truncated: mine.length > MAX_DIAGS,
      otherFiles: parsed.all.length - mine.length,
    };
  });
  tscLocks.set(tsconfig, job);
  return job;
}

/**
 * Prüft eine Datei mit dem passenden Provider. Es gibt nur ehrliche Zustände: `ok` heißt „Provider vollständig
 * gelaufen, keine Fehler“ — fehlt ein Provider, ist es `not_configured`, nie „0 Fehler“.
 */
export async function runDiagnostics(root: string, path: string, opts: DiagnosticsOptions): Promise<DiagnosticsResult | null> {
  const started = Date.now();
  const file = await resolveFile(root, path);
  if (!file) return null;
  const ext = extname(file.rel).toLowerCase();
  const language = languageOf(file.rel);
  const common = (extra: Partial<DiagnosticsResult> & { state: DiagnosticsResult["state"] }): DiagnosticsResult => ({
    ...base(file.rel, file.revision, language, started),
    provider: null,
    scope: null,
    detail: null,
    diagnostics: [],
    ...extra,
  });
  const withPath = (ds: Diagnostic[]) => ds.map((d) => ({ ...d, path: file.rel }));

  if (ext === ".json" || ext === ".ipynb") {
    const res = await jsonDiagnostics(file.real, file.size);
    if (res === "too_large") return common({ state: "too_large", provider: "JSON.parse", scope: "syntax", detail: `Größer als ${JSON_MAX_BYTES / 1024 / 1024} MiB — nicht geprüft.` });
    return common({ state: res.ok ? "ok" : "errors", provider: "JSON.parse", scope: "syntax", diagnostics: withPath(res.diagnostics) });
  }
  if (ext === ".py") {
    const res = await pythonDiagnostics(file.real, file.size);
    if (res === "too_large") return common({ state: "too_large", provider: "Python ast", scope: "syntax", detail: `Größer als ${PY_MAX_BYTES / 1024 / 1024} MiB — nicht geprüft.` });
    if ("failed" in res) return common({ state: "failed", provider: "Python ast", scope: "syntax", detail: res.failed });
    return common({
      state: res.ok ? "ok" : "errors",
      provider: "Python ast",
      scope: "syntax",
      detail: res.ok ? "Nur Syntax geprüft (kein Typ-/Importcheck) — ein konfigurierter Checker wie pyright oder ruff ist nicht eingebunden." : null,
      diagnostics: withPath(res.diagnostics),
    });
  }
  if (TS_EXT.has(ext)) {
    const res = await tscDiagnostics(root, file.real, file.rel, opts);
    return common(res);
  }
  return common({ state: "not_configured", detail: `Für ${language === "text" ? "diesen Dateityp" : language} ist keine Diagnose eingerichtet — Syntaxfarben sind keine Fehlerprüfung.` });
}
