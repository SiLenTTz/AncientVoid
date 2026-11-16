import { lstat } from "node:fs/promises";
import { dirname, posix, resolve, win32 } from "node:path";

/**
 * BUG-0175: Pfad-Vergleiche dürfen nicht von einem einzigen Trennzeichen
 * abhängen. Auf Windows sehen Pfade `E:\Coding\…` aus, aus Provider-Protokollen
 * und Konfigs kommen sie aber auch mit `/`. Ein Vergleich wie
 * `project.startsWith(root + "/")` sortiert deshalb auf Windows jeden Pfad
 * unterhalb einer Wurzel aus — der Nutzer ließ `projectRoots` leer und verlor
 * damit die Allowlist (AC-P1.5-5).
 *
 * Der Pfadstil ist hier ein Parameter, damit der Windows-Zweig auch auf einem
 * Linux-CI prüfbar bleibt.
 */
export type PathStyle = "win32" | "posix";

export function pathStyle(platform: NodeJS.Platform = process.platform): PathStyle {
  return platform === "win32" ? "win32" : "posix";
}

/**
 * Liegt `child` in `parent` (identisch zählt als innen)? Auf win32 sind
 * Trennzeichen gemischt erlaubt und Groß-/Kleinschreibung gleichgültig, auf
 * posix beides nicht. `..`-Ausstieg und andere Laufwerke sind außerhalb.
 */
export function pathWithin(child: string, parent: string, style: PathStyle = pathStyle()): boolean {
  const impl = style === "win32" ? win32 : posix;
  const rel = impl.relative(impl.resolve(parent), impl.resolve(child));
  if (rel === "") return true;
  if (impl.isAbsolute(rel)) return false; // anderes Laufwerk (win32) oder anderer Stamm
  return rel.split(impl.sep)[0] !== "..";
}

/**
 * Tiefster existierender Ordner auf dem Weg zu `target` (oder `target` selbst).
 * BUG-0171: ein Session-Ziel darf einen noch fehlenden Blattordner haben —
 * erlaubt sein soll es trotzdem, aber nur innerhalb einer erlaubten Wurzel.
 * `null`, wenn nichts auf dem Weg existiert.
 */
export async function nearestExistingAncestor(target: string): Promise<string | null> {
  let dir = resolve(target);
  for (;;) {
    try {
      await lstat(dir);
      return dir;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR" && code !== "ENAMETOOLONG") return null;
      const parent = dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  }
}
