import { constants } from "node:fs";
import { access, readdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { VAULT_MAX_BYTES, VAULT_MAX_LIST, VAULT_NAME_PATTERN, type VaultBrowse, type VaultBrowseEntry, type VaultFile, type VaultListing, type VaultRead, type VaultState } from "@ancientvoid/contracts";
import { revisionOf } from "../code/index.ts";

/** DI wie ActionRunner: der Store kennt keine SQLite-Details, nur lesen/schreiben des Roots. */
export interface VaultStoreIo {
  getRoot(): string | null;
  setRoot(path: string | null): void;
  /** Zulässige Startpunkte des Verzeichnis-Browsers (projectRoots + Home, absolut). */
  browseRoots(): string[];
  /** Pfad, den der Browser niemals anbietet (dataDir des Hubs). */
  forbiddenRoot(): string | null;
}
export class VaultStore {
  private readonly io: VaultStoreIo;

  constructor(io: VaultStoreIo) {
    this.io = io;
  }

  state(): VaultState {
    const root = this.io.getRoot();
    return root
      ? { configured: true, root, label: basename(root) || root }
      : { configured: false, root: null, label: null };
  }

  /** Startpunkte begrenzen nur Browse; die explizite Root-Wahl bleibt dem Menschen frei. */
  async setRoot(path: string): Promise<VaultState> {
    const real = await this.directoryReal(path);
    this.io.setRoot(real);
    return this.state();
  }

  private async directoryReal(path: string): Promise<string> {
    let real: string;
    try {
      real = await realpath(resolve(path));
      if (!(await stat(real)).isDirectory()) throw new VaultError("Das Ziel ist kein Verzeichnis.", 422);
      await access(real, constants.R_OK | constants.X_OK);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") throw new VaultError("Ordner nicht gefunden.", 422);
      if (code === "ENOTDIR") throw new VaultError("Das Ziel ist kein Verzeichnis.", 422);
      if (code === "EACCES" || code === "EPERM") throw new VaultError("Keine Zugriffsrechte auf den Ordner.", 422);
      if (code === "ELOOP") throw new VaultError("Der Ordner enthält eine ungültige Symlink-Schleife.", 422);
      throw err;
    }
    const forbidden = this.io.forbiddenRoot();
    if (forbidden) {
      const realForbidden = await realpath(forbidden).catch(() => null);
      if (realForbidden && isInside(realForbidden, real)) throw new VaultError("Das Datenverzeichnis des Hubs ist als Vault nicht erlaubt.", 422);
    }
    if (basename(real) === ".git" || real.includes(`${sep}.git${sep}`)) throw new VaultError("Innerhalb von .git liegt kein Vault.", 422);
    return real;
  }

  private async withinStartpoints(real: string): Promise<boolean> {
    const current = this.io.getRoot();
    const reals = await Promise.all([...this.io.browseRoots(), homeOf(), ...(current ? [current] : [])].map((r) => realpath(r).catch(() => null)));
    return reals.some((a) => a !== null && isInside(a, real));
  }

  private async rootReal(): Promise<string> {
    const root = this.io.getRoot();
    if (!root) throw new VaultError("Kein Vault-Ordner gewählt.", 422);
    return this.directoryReal(root);
  }

  /** Verzeichnis-Browser: ohne Pfad die Startpunkte, sonst containment-geprüft eine Ebene Ordner. */
  async browse(path: string | null): Promise<VaultBrowse> {
    const roots: VaultBrowseEntry[] = [];
    const current = this.io.getRoot();
    for (const r of [...this.io.browseRoots(), ...(current ? [current] : [])]) {
      try {
        const real = await this.directoryReal(r);
        if (!roots.some(entry => entry.path === real)) roots.push({ name: basename(real) || real, path: real });
      } catch (err) {
        if (!(err instanceof VaultError)) throw err;
      }
    }
    if (!path || path === "") return { path: "", parent: null, dirs: [], roots };
    const real = await this.directoryReal(path);
    if (!(await this.withinStartpoints(real))) throw new VaultError("Außerhalb der Startpunkte.", 422);
    const entries = await readdir(real, { withFileTypes: true });
    const dirs: VaultBrowseEntry[] = [];
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if ((!e.isDirectory() && !e.isSymbolicLink()) || e.name === ".git" || e.name.startsWith("node_modules")) continue;
      const abs = join(real, e.name);
      try {
        const target = await this.directoryReal(abs);
        if (await this.withinStartpoints(target)) dirs.push({ name: e.name, path: abs });
      } catch (err) {
        // Tote Links und gesperrte Ziele sind keine navigierbaren Ordner.
        if (!(err instanceof VaultError)) throw err;
      }
    }
    const parent = dirname(real);
    return {
      path: real,
      parent: parent !== real && parent.startsWith(sep) ? parent : null,
      dirs,
      roots: [],
    };
  }

  /** Rekursive Liste mit Cap; `.md`/`.mdx` sind editierbar, alles andere Ansicht. */
  async list(): Promise<VaultListing> {
    const root = await this.rootReal();
    const files: VaultFile[] = [];
    let truncated = false;
    const dirs: string[] = [root];
    const visited = new Set<string>();
    while (dirs.length > 0 && !truncated) {
      const dir = dirs.shift()!;
      let target: string;
      try {
        target = await this.directoryReal(dir);
      } catch (err) {
        if (err instanceof VaultError) continue;
        throw err;
      }
      if (!isInside(root, target) || visited.has(target)) continue;
      visited.add(target);
      const entries = await readdir(dir, { withFileTypes: true });
      for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (e.name === ".git" || e.name === "node_modules") continue;
        const abs = join(dir, e.name);
        if (e.isDirectory() || e.isSymbolicLink()) {
          dirs.push(abs);
          continue;
        }
        if (!e.isFile()) continue;
        if (files.length >= VAULT_MAX_LIST) {
          truncated = true;
          break;
        }
        const info = await stat(abs);
        files.push({ path: relPosix(root, abs), bytes: info.size, modifiedAt: info.mtime.toISOString(), editable: /\.(md|mdx)$/i.test(e.name) });
      }
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    return { files, truncated };
  }

  /** Neue Notiz: nur `.md`, Namens-Regex, nie überschreiben. */
  async create(name: string): Promise<VaultFile> {
    if (!VAULT_NAME_PATTERN.test(name)) throw new VaultError("Name passt nicht zum Muster (Buchstabe/Ziffer zuerst, dann Buchstaben, Zahlen, ._-).", 422);
    const root = await this.rootReal();
    const rel = `${name}.md`;
    const abs = join(root, rel);
    await this.assertInside(root, abs, rel);
    if (await exists(abs)) throw new VaultError("Eine Datei mit diesem Namen existiert bereits.", 409);
    await writeFile(abs, `# ${name}\n\n`, { flag: "wx" });
    const info = await stat(abs);
    return { path: rel, bytes: info.size, modifiedAt: info.mtime.toISOString(), editable: true };
  }

  async read(path: string): Promise<VaultRead> {
    const root = await this.rootReal();
    const abs = join(root, path);
    await this.assertInside(root, abs, path);
    const info = await stat(abs).catch(() => {
      throw new VaultError("Datei nicht gefunden.", 404);
    });
    if (!info.isFile()) throw new VaultError("Keine Datei.", 422);
    const revision = revisionOf(info);
    if (info.size > VAULT_MAX_BYTES) return { path, revision, bytes: info.size, text: null };
    return { path, revision, bytes: info.size, text: await readFile(abs, "utf8") };
  }

  /** Speichern: nur `.md`/`.mdx`, Cap, Revision-Guard, atomar (tmp + Rename im selben Ordner). */
  async write(path: string, text: string, revision: string): Promise<VaultRead> {
    if (!/\.(md|mdx)$/i.test(path)) throw new VaultError("Editierbar sind nur Markdown-Dateien.", 422);
    const root = await this.rootReal();
    const abs = join(root, path);
    await this.assertInside(root, abs, path);
    if (Buffer.byteLength(text, "utf8") > VAULT_MAX_BYTES) throw new VaultError("Notiz größer als 1 MiB.", 422);
    if (!(await stat(abs).catch(() => null))?.isFile()) throw new VaultError("Datei nicht gefunden.", 404);
    if (revisionOf(await stat(abs)) !== revision) throw new VaultError("Die Notiz hat sich geändert — neu laden.", 409);
    const tmp = join(dirname(abs), `.${basename(abs)}.av-tmp-${process.pid}-${Date.now()}`);
    await writeFile(tmp, text, "utf8");
    await rename(tmp, abs);
    const info = await stat(abs);
    return { path, revision: revisionOf(info), bytes: info.size, text: null };
  }

  private async assertInside(rootReal: string, abs: string, rel: string): Promise<void> {
    if (rel.startsWith("/") || rel.split("/").some((p) => p === ".." || p === "")) {
      throw new VaultError("Pfad liegt außerhalb des Vault-Ordners.", 422);
    }
    // Neue Dateien existieren noch nicht: ihr Ordner muss real drin liegen; existierende
    // Pfade werden selbst aufgelöst (Symlink-Ausbrüche fliegen auf).
    const real = await realpath(abs).catch(() => null);
    const realParent = await realpath(dirname(abs)).catch(() => null);
    const inside =
      real !== null
        ? isInside(rootReal, real)
        : realParent !== null && isInside(rootReal, realParent);
    if (!inside) throw new VaultError("Pfad liegt außerhalb des Vault-Ordners.", 422);
    const forGitCheck = real ?? realParent;
    if (forGitCheck?.includes(`${sep}.git${sep}`) || forGitCheck?.endsWith(`${sep}.git`)) throw new VaultError(".git ist gesperrt.", 422);
    await access(realParent ?? forGitCheck!, constants.W_OK).catch(() => {
      throw new VaultError("Keine Schreibrechte im Vault-Ordner.", 422);
    });
  }
}

export class VaultError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function homeOf(): string {
  return process.env.HOME ?? process.cwd();
}

function relPosix(root: string, abs: string): string {
  return relative(root, abs).split(sep).join("/");
}

function isInside(root: string, path: string): boolean {
  return path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);
}

async function exists(p: string): Promise<boolean> {
  return stat(p)
    .then(() => true)
    .catch(() => false);
}
