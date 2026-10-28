import { open, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/** Dateien eines Verzeichnisses, nur reguläre (keine Symlinks), sortiert; fehlendes Verzeichnis = leer. */
export async function listFiles(dir: string, pattern: RegExp): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && pattern.test(e.name)).map((e) => e.name).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

export async function readJson(file: string): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; reason: "missing" | "invalid" }> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { ok: false, reason: "missing" };
    throw err;
  }
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? { ok: true, value: value as Record<string, unknown> } : { ok: false, reason: "invalid" };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

export interface Tail {
  lines: string[];
  /** Neue Leseposition: hinter der letzten VOLLSTÄNDIGEN Zeile (eine halb geschriebene bleibt liegen). */
  offset: number;
  size: number;
}

/**
 * Liest ab `from` höchstens `maxBytes`. Wurde die Datei kürzer (rotiert/ersetzt), beginnt das Lesen von vorn.
 * Ohne `from` (null) startet der Leser am Ende: die Vorgeschichte wird nicht nachgespielt.
 */
export async function tailLines(file: string, from: number | null, maxLines: number, maxBytes = 256 * 1024): Promise<Tail> {
  const fh = await open(file, "r");
  try {
    const { size } = await fh.stat();
    if (from === null) return { lines: [], offset: size, size };
    const start = from > size ? 0 : from;
    const length = Math.min(size - start, maxBytes);
    if (length <= 0) return { lines: [], offset: start, size };
    const buf = Buffer.alloc(length);
    await fh.read(buf, 0, length, start);
    const end = buf.lastIndexOf(0x0a);
    if (end < 0) return { lines: [], offset: start, size };
    const lines = buf.subarray(0, end).toString("utf8").split("\n").slice(0, maxLines);
    return { lines, offset: start + Buffer.byteLength(`${lines.join("\n")}\n`), size };
  } finally {
    await fh.close();
  }
}

export const under = (root: string, ...parts: string[]) => join(root, ...parts);
