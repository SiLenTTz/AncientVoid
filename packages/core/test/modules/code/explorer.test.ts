import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkspaceIdentity } from "@ancientvoid/contracts";
import { compareEntries, fileMeta, listTree, readRange } from "../../../src/modules/code/explorer.ts";

const identity: WorkspaceIdentity = { kind: "project", sessionId: null, root: "/x", branch: null, head: null, base: null };

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "av-p46-"));
  const git = (...a: string[]) => execFileSync("git", ["-C", dir, "-c", "user.email=t@t", "-c", "user.name=t", ...a], { stdio: "ignore" });
  git("init", "-q", "-b", "main");
  writeFileSync(join(dir, ".gitignore"), "node_modules/\n*.log\n");
  writeFileSync(join(dir, "tracked.txt"), "x\n");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  return dir;
}

/** Alle Chunks bis EOF zusammensetzen — so liest die UI. */
async function readAll(root: string, path: string, encoding: "utf-8" | "utf-16le" | "utf-16be", length: number): Promise<string> {
  let out = "";
  let offset = 0;
  let revision: string | undefined;
  for (let guard = 0; guard < 100_000; guard++) {
    const res = await readRange(root, path, { offset, length, as: "text", encoding, ...(revision ? { revision } : {}) });
    if (!res.ok) throw new Error(res.reason);
    revision = res.range.revision;
    out += res.range.text;
    if (res.range.nextOffset === null) return out;
    offset = res.range.nextOffset;
  }
  throw new Error("kein EOF");
}

describe("EPIC-P46 Tree (ADR-0058)", () => {
  it("sortiert natürlich, Ordner zuerst", () => {
    const names = ["file10.ts", "file2.ts", "Zeta", "alpha", "File1.ts"].map((name) => ({ name, kind: name === "Zeta" || name === "alpha" ? "dir" : "file" }));
    expect(names.sort(compareEntries).map((e) => e.name)).toEqual(["alpha", "Zeta", "File1.ts", "file2.ts", "file10.ts"]);
  });

  it("zeigt dotfiles, markiert untracked/modified, zählt Ignoriertes und blendet es auf Wunsch ein; .git ist sichtbar gesperrt", async () => {
    const dir = repo();
    mkdirSync(join(dir, "node_modules/pkg"), { recursive: true });
    writeFileSync(join(dir, "node_modules/pkg/index.js"), "x");
    writeFileSync(join(dir, "debug.log"), "x");
    writeFileSync(join(dir, ".env.local"), "x");
    writeFileSync(join(dir, "neu.txt"), "x");
    writeFileSync(join(dir, "tracked.txt"), "geändert\n");
    const hidden = (await listTree(dir, "", identity))!;
    const names = hidden.entries.map((e) => e.name);
    expect(names).toContain(".env.local");
    expect(names).toContain(".git");
    expect(names).not.toContain("node_modules");
    expect(hidden.filters.ignoredHidden).toBe(2); // node_modules + debug.log — gezählt, nicht verschwiegen
    expect(hidden.entries.find((e) => e.name === ".git")?.blocked).toMatch(/gesperrt/);
    expect(hidden.entries.find((e) => e.name === "neu.txt")?.git).toBe("untracked");
    expect(hidden.entries.find((e) => e.name === "tracked.txt")?.git).toBe("modified");
    const all = (await listTree(dir, "", identity, { ignored: true }))!;
    expect(all.entries.map((e) => e.name)).toContain("node_modules");
    expect(all.entries.find((e) => e.name === "node_modules")?.git).toBe("ignored");
    expect(await listTree(dir, ".git", identity)).toBeNull();
  });

  it("paginiert ohne Verlust und erreicht tief verschachtelte Dateien", async () => {
    const dir = repo();
    for (let i = 0; i < 25; i++) writeFileSync(join(dir, `f${String(i).padStart(2, "0")}.txt`), "x");
    const deep = "a/b/c/d/e/f/g/h/i/j";
    mkdirSync(join(dir, deep), { recursive: true });
    writeFileSync(join(dir, deep, "tief.txt"), "x");
    const seen: string[] = [];
    let offset = 0;
    for (;;) {
      const page = (await listTree(dir, "", identity, { limit: 10, offset }))!;
      seen.push(...page.entries.map((e) => e.name));
      if (page.nextOffset === null) break;
      offset = page.nextOffset;
    }
    expect(seen.filter((n) => n.startsWith("f"))).toHaveLength(25);
    expect((await listTree(dir, deep, identity))!.entries.map((e) => e.name)).toEqual(["tief.txt"]);
  });

  it("Containment: kein Ausbruch per ../, Link nach außen gesperrt, Link-Schleife innerhalb bleibt endlich", async () => {
    const dir = repo();
    const outside = mkdtempSync(join(tmpdir(), "av-p46-out-"));
    writeFileSync(join(outside, "geheim.txt"), "geheim");
    symlinkSync(outside, join(dir, "ausbruch"));
    mkdirSync(join(dir, "sub"));
    symlinkSync(dir, join(dir, "sub", "schleife"));
    expect(await listTree(dir, "../", identity)).toBeNull();
    expect(await listTree(dir, "ausbruch", identity)).toBeNull();
    const root = (await listTree(dir, "", identity))!;
    expect(root.entries.find((e) => e.name === "ausbruch")?.blocked).toMatch(/heraus/);
    const sub = (await listTree(dir, "sub", identity))!;
    const loop = sub.entries.find((e) => e.name === "schleife")!;
    expect(loop).toMatchObject({ kind: "dir", symlink: true });
    // Lazy: ein Schritt in die Schleife listet wieder die Root — kein Endlos-Rekursionsproblem
    expect((await listTree(dir, "sub/schleife", identity))!.entries.map((e) => e.name)).toContain("sub");
  });
});

describe("EPIC-P46 Range/Meta (ADR-0058)", () => {
  it("liest eine Textdatei > 1 MiB bis zum letzten Zeichen, Mehrbyte-Zeichen an Chunkgrenzen bleiben ganz", async () => {
    const dir = repo();
    const line = "Zeile mit Umlauten äöü, Emoji 😀🚀 und CJK 漢字\n";
    const text = line.repeat(Math.ceil((1.3 * 1024 * 1024) / Buffer.byteLength(line)));
    writeFileSync(join(dir, "gross.txt"), text);
    expect(Buffer.byteLength(text)).toBeGreaterThan(1024 * 1024);
    for (const length of [4096, 65_537, 262_144]) {
      expect(await readAll(dir, "gross.txt", "utf-8", length)).toBe(text);
    }
  });

  it("UTF-16 (LE mit BOM, BE) inklusive Surrogatpaaren über Chunkgrenzen; CRLF wird erkannt", async () => {
    const dir = repo();
    const text = "Hallo 😀 Welt\r\n".repeat(20_000);
    const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
    writeFileSync(join(dir, "le.txt"), le);
    const be = Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(Buffer.from(text, "utf16le")).swap16()]);
    writeFileSync(join(dir, "be.txt"), be);
    const meta = (await fileMeta(dir, "le.txt", identity))!;
    expect(meta).toMatchObject({ encoding: "utf-16le", bomBytes: 2, eol: "crlf", family: "text" });
    expect((await fileMeta(dir, "be.txt", identity))!.encoding).toBe("utf-16be");
    expect(await readAll(dir, "le.txt", "utf-16le", 4097)).toBe(text);
    expect(await readAll(dir, "be.txt", "utf-16be", 4097)).toBe(text);
  });

  it("Binärdatei: Bytes bis zum letzten Byte, unbekanntes Format ist binary, nicht leer", async () => {
    const dir = repo();
    const bytes = Buffer.alloc(300_001);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7) & 0xff;
    writeFileSync(join(dir, "daten.bin"), bytes);
    const meta = (await fileMeta(dir, "daten.bin", identity))!;
    expect(meta).toMatchObject({ family: "binary", encoding: "binary", bytes: 300_001 });
    const parts: Buffer[] = [];
    let offset = 0;
    for (;;) {
      const res = await readRange(dir, "daten.bin", { offset, length: 100_000, as: "bytes", revision: meta.revision });
      if (!res.ok) throw new Error(res.reason);
      parts.push(Buffer.from(res.range.base64!, "base64"));
      if (res.range.nextOffset === null) break;
      offset = res.range.nextOffset;
    }
    expect(Buffer.concat(parts).equals(bytes)).toBe(true);
  });

  it("Revision: eine Änderung zwischen Chunks wird gemeldet statt zwei Versionen zu mischen", async () => {
    const dir = repo();
    writeFileSync(join(dir, "a.txt"), "x".repeat(10_000));
    const first = await readRange(dir, "a.txt", { offset: 0, length: 4000, as: "text" });
    if (!first.ok) throw new Error("erster Chunk");
    writeFileSync(join(dir, "a.txt"), "y".repeat(10_001));
    utimesSync(join(dir, "a.txt"), new Date(), new Date(Date.now() + 5000));
    const second = await readRange(dir, "a.txt", { offset: first.range.nextOffset!, length: 4000, as: "text", revision: first.range.revision });
    expect(second).toMatchObject({ ok: false, reason: "revision_changed" });
  });

  it("Containment gilt auch für Meta/Range", async () => {
    const dir = repo();
    expect(await fileMeta(dir, "../etc/passwd", identity)).toBeNull();
    expect(await fileMeta(dir, ".git/config", identity)).toBeNull();
    expect(await readRange(dir, "/etc/passwd", { offset: 0, as: "text" })).toMatchObject({ ok: false, reason: "not_found" });
  });
});
