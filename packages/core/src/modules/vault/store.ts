import { constants } from "node:fs";
import { access, readdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
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

  /** Root-Wahl: muss existieren, Verzeichnis und innerhalb der Startpunkte liegen; dataDir/.git abgelehnt. */
  async setRoot(path: string): Promise<VaultState> {
    const real = await realpath(resolve(path));
    const info = await stat(real);
    if (!info.isDirectory()) throw new VaultError("Das Ziel ist kein Verzeichnis.", 422);
    const forbidden = this.io.forbiddenRoot();
    if (forbidden) {
      const realForbidden = await realpath(forbidden).catch(() => null);
      if (realForbidden && (real === realForbidden || real.startsWith(realForbidden + sep))) throw new VaultError("Das Datenverzeichnis des Hubs ist als Vault nicht erlaubt.", 422);
    }
    if (basename(real) === ".git" || real.includes(`${sep}.git${sep}`)) throw new VaultError("Innerhalb von .git liegt kein Vault.", 422);
    if (!(await this.withinStartpoints(real))) throw new VaultError("Der Ordner liegt außerhalb der Startpunkte (Projektwurzeln/Home).", 422);
    this.io.setRoot(real);
    return this.state();
  }

  private async withinStartpoints(real: string): Promise<boolean> {
    const reals = await Promise.all([...this.io.browseRoots(), homeOf()].map((r) => realpath(r).catch(() => null)));
    return reals.some((a) => a !== null && (real === a || real.startsWith(a + sep)));
  }

  private async rootReal(): Promise<string> {
    const root = this.io.getRoot();
    if (!root) throw new VaultError("Kein Vault-Ordner gewählt.", 422);
    return realpath(root);
  }

  /** Verzeichnis-Browser: ohne Pfad die Startpunkte, sonst containment-geprüft eine Ebene Ordner. */
  async browse(path: string | null): Promise<VaultBrowse> {
    const roots: VaultBrowseEntry[] = [];
    for (const r of this.io.browseRoots()) {
      const real = await realpath(r).catch(() => null);
      if (real) roots.push({ name: basename(real) || real, path: real });
    }
    if (!path || path === "") return { path: "", parent: null, dirs: [], roots };
    const real = await realpath(resolve(path));
    if (!(await this.withinStartpoints(real))) throw new VaultError("Außerhalb der Startpunkte.", 422);
    const entries = (await readdir(real, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && e.name !== ".git" && !e.name.startsWith("node_modules"))
      .sort((a, b) => a.name.localeCompare(b.name));
    const parent = dirname(real);
    return {
      path: real,
      parent: parent !== real && parent.startsWith(sep) ? parent : null,
      dirs: entries.map((e) => ({ name: e.name, path: join(real, e.name) })),
      roots: [],
    };
  }

  /** Rekursive Liste mit Cap; `.md`/`.mdx` sind editierbar, alles andere Ansicht. */
  async list(): Promise<VaultListing> {
    const root = await this.rootReal();
    const files: VaultFile[] = [];
    let truncated = false;
    const dirs: string[] = [root];
    while (dirs.length > 0 && !truncated) {
      const dir = dirs.shift()!;
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (e.name === ".git" || e.name === "node_modules") continue;
        const abs = join(dir, e.name);
        if (e.isDirectory()) {
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
        ? real === rootReal || real.startsWith(rootReal + sep)
        : realParent !== null && (realParent === rootReal || realParent.startsWith(rootReal + sep));
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
  return abs.slice(root.length + 1).split(sep).join("/");
}

async function exists(p: string): Promise<boolean> {
  return stat(p)
    .then(() => true)
    .catch(() => false);
}
