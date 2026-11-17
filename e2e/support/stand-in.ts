import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * BUG-0179: die Stand-in-CLIs in `e2e/support/bin/` sind Shebang-Skripte ohne Endung.
 * Auf Windows kann CreateProcess damit nichts anfangen (`spawn ENOENT`); Node startet `.cmd`
 * nur mit Shell (CVE-2024-27980), und `shellFor` in contracts schaltet die Shell genau für
 * solche Pfade ein. Auf Unix bleibt der Originalpfad in Benutzung.
 *
 * Die Wrapper landen in `data/tmp-e2e/bin` (git-ignored) und werden pro Name einmal
 * geschrieben — Tests laufen parallel, deshalb der Zwischenspeicher plus geschützte Anlage.
 */
const binDir = resolve(import.meta.dirname, "bin");
const wrapperDir = resolve(import.meta.dirname, "../..", "data", "tmp-e2e", "bin");
const cache = new Map<string, string>();

export function standIn(name: string): string {
  const original = join(binDir, name);
  if (process.platform !== "win32") return original;
  const seen = cache.get(name);
  if (seen) return seen;
  mkdirSync(wrapperDir, { recursive: true });
  const wrapper = join(wrapperDir, `${name}.cmd`);
  writeFileSync(wrapper, `@echo off\r\nnode "${original}" %*\r\n`);
  cache.set(name, wrapper);
  return wrapper;
}

/** Verzeichnis der Wrapper — fürfälle, die Attrappen über den PATH finden. */
export const standInDir = wrapperDir;
