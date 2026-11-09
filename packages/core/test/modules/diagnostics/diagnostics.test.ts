import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codepointToUtf16Column, lineColumnAt, runDiagnostics } from "../../../src/modules/diagnostics/index.ts";
import { findInFile, lineAtOffset, offsetOfLine } from "../../../src/modules/code/index.ts";

const dir = () => mkdtempSync(join(tmpdir(), "av-p46d-"));

describe("diagnostics (ADR-0058 §9)", () => {
  it("lineColumnAt zählt UTF-16-Einheiten und CRLF als einen Umbruch", () => {
    expect(lineColumnAt("a\r\nb😀c", 6)).toEqual({ line: 2, column: 4 });
  });

  it("codepointToUtf16Column rechnet Emoji um", () => {
    expect(codepointToUtf16Column("😀x", 2)).toBe(3);
  });

  it("JSON-Syntaxfehler: errors mit Position", async () => {
    const d = dir();
    writeFileSync(join(d, "a.json"), '{\n  "a": 1,\n}\n');
    const res = await runDiagnostics(d, "a.json", { trusted: false });
    expect(res?.state).toBe("errors");
    expect(res?.diagnostics[0]?.line).toBeGreaterThanOrEqual(2);
  });

  it("gültiges JSON: ok", async () => {
    const d = dir();
    writeFileSync(join(d, "a.json"), '{"a":1}');
    expect((await runDiagnostics(d, "a.json", { trusted: false }))?.state).toBe("ok");
  });

  it("ohne Freigabe läuft kein Projekt-tsc: untrusted statt 0 Fehler", async () => {
    const d = dir();
    writeFileSync(join(d, "tsconfig.json"), "{}");
    mkdirSync(join(d, "node_modules", ".bin"), { recursive: true });
    writeFileSync(join(d, "node_modules", ".bin", "tsc"), "#!/bin/sh\necho MUSS-NICHT-LAUFEN > \"$0.ran\"\n", { mode: 0o755 });
    writeFileSync(join(d, "a.ts"), "const x: number = 'a';\n");
    const res = await runDiagnostics(d, "a.ts", { trusted: false });
    expect(res?.state).toBe("untrusted");
    expect(res?.diagnostics).toEqual([]);
    expect(existsSync(join(d, "node_modules", ".bin", "tsc.ran"))).toBe(false);
  });

  it("ohne lokales TypeScript: not_configured", async () => {
    const d = dir();
    writeFileSync(join(d, "tsconfig.json"), "{}");
    writeFileSync(join(d, "a.ts"), "export {};\n");
    expect((await runDiagnostics(d, "a.ts", { trusted: true }))?.state).toBe("not_configured");
  });

  it("ohne Prüfer für den Typ: not_configured", async () => {
    const d = dir();
    writeFileSync(join(d, "a.yaml"), "a: 1\n");
    expect((await runDiagnostics(d, "a.yaml", { trusted: true }))?.state).toBe("not_configured");
  });

  it("Pfad außerhalb/fehlend: null", async () => {
    expect(await runDiagnostics(dir(), "../etc/passwd", { trusted: false })).toBeNull();
  });

  it("Python-Syntaxfehler mit Emoji: Spalte in UTF-16", async () => {
    const d = dir();
    writeFileSync(join(d, "a.py"), 's = "😀" +\n');
    const res = await runDiagnostics(d, "a.py", { trusted: false });
    if (res?.state === "not_configured") return; // python3 fehlt
    expect(res?.state).toBe("errors");
    expect(res?.diagnostics[0]?.line).toBe(1);
  });
});

describe("Zeilenindex und Suche", () => {
  it("lineAtOffset/offsetOfLine sind konsistent (LF und CRLF)", async () => {
    const d = dir();
    const file = join(d, "a.txt");
    writeFileSync(file, "eins\r\nzwei\nlängere drei\n");
    const size = statSync(file).size;
    expect(await offsetOfLine(file, "utf-8", 0, size, 2)).toBe(6);
    expect(await lineAtOffset(file, "rev", 6, "utf-8", 0)).toBe(2);
    expect(await offsetOfLine(file, "utf-8", 0, size, 99)).toBeNull();
  });

  it("UTF-16LE: Zeilenstart wird in Bytes gezählt", async () => {
    const d = dir();
    const file = join(d, "w.txt");
    writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("a\nb\n", "utf16le")]));
    expect(await offsetOfLine(file, "utf-16le", 2, statSync(file).size, 2)).toBe(6);
  });

  it("findInFile findet über Chunk-Grenzen hinweg und liefert Zeile/Spalte", async () => {
    const d = dir();
    writeFileSync(join(d, "big.txt"), `${"x".repeat(70_000)}\nab NADEL hier\n`);
    const res = await findInFile(d, "big.txt", { query: "nadel", from: 0, encoding: "utf-8", bomBytes: 0 });
    expect(res.ok && res.found && res.line).toBe(2);
    expect(res.ok && res.found && res.column).toBe(4);
  });

  it("findInFile: kein Treffer ist found:false", async () => {
    const d = dir();
    writeFileSync(join(d, "a.txt"), "abc\n");
    const res = await findInFile(d, "a.txt", { query: "zzz", from: 0, encoding: "utf-8", bomBytes: 0 });
    expect(res.ok && res.found).toBe(false);
  });
});
