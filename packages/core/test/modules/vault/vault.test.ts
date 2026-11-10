import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VaultError, VaultStore, type VaultStoreIo } from "../../../src/modules/vault/store.ts";

function setup() {
  const base = mkdtempSync(join(tmpdir(), "av-p49-"));
  const vaultDir = join(base, "mein-vault");
  const other = join(base, "anders");
  mkdirSync(vaultDir);
  mkdirSync(other);
  mkdirSync(join(base, "projekte", "alpha"), { recursive: true });
  mkdirSync(join(base, "hub-data"), { recursive: true });
  let root: string | null = null;
  const io: VaultStoreIo = {
    getRoot: () => root,
    setRoot: (p) => {
      root = p;
    },
    browseRoots: () => [join(base, "projekte"), join(base, "mein-vault")],
    forbiddenRoot: () => join(base, "hub-data"),
  };
  return { base, vaultDir, other, io, store: new VaultStore(io) };
}

describe("EPIC-P49 VaultStore (ADR-0063)", () => {
  it("state: unkonfiguriert ist ehrlich leer", () => {
    const { store } = setup();
    expect(store.state()).toEqual({ configured: false, root: null, label: null });
  });

  it("setRoot: gültiger Ordner innerhalb der Startpunkte wird gespeichert; Außenseiter abgelehnt", async () => {
    const { store, vaultDir, other } = setup();
    const state = await store.setRoot(vaultDir);
    expect(state.configured).toBe(true);
    expect(state.label).toBe("mein-vault");
    await expect(store.setRoot(other)).rejects.toThrow(/außerhalb der startpunkte/i);
  });

  it("setRoot: dataDir des Hubs und .git-Inneres abgelehnt", async () => {
    const { base, store, vaultDir } = setup();
    await expect(store.setRoot(join(base, "hub-data"))).rejects.toThrow(/Datenverzeichnis/);
    mkdirSync(join(vaultDir, ".git"), { recursive: true });
    await expect(store.setRoot(join(vaultDir, ".git"))).rejects.toThrow(/\.git/);
  });

  it("list: rekursiv mit Ordnerstruktur, md editierbar, andere nur Ansicht", async () => {
    const { store, vaultDir } = setup();
    await store.setRoot(vaultDir);
    writeFileSync(join(vaultDir, "notiz.md"), "# N\n");
    mkdirSync(join(vaultDir, "unter"));
    writeFileSync(join(vaultDir, "unter", "bild.png"), "x");
    writeFileSync(join(vaultDir, "unter", "tief.md"), "# T\n");
    const { files } = await store.list();
    expect(files.map((f) => f.path)).toEqual(["notiz.md", "unter/bild.png", "unter/tief.md"]);
    expect(files.find((f) => f.path === "notiz.md")?.editable).toBe(true);
    expect(files.find((f) => f.path === "unter/bild.png")?.editable).toBe(false);
  });

  it("create: nur .md mit Namens-Regex, keine Überschreibung", async () => {
    const { store, vaultDir } = setup();
    await store.setRoot(vaultDir);
    const f = await store.create("Wichtige Notiz");
    expect(f.path).toBe("Wichtige Notiz.md");
    expect(readFileSync(join(vaultDir, "Wichtige Notiz.md"), "utf8")).toContain("# Wichtige Notiz");
    await expect(store.create("Wichtige Notiz")).rejects.toMatchObject({ status: 409 });
    await expect(store.create("../flug")).rejects.toMatchObject({ status: 422 });
    await expect(store.create("a/b")).rejects.toMatchObject({ status: 422 });
  });

  it("write: Revision-Guard (409), .md-Only, atomares Speichern", async () => {
    const { store, vaultDir } = setup();
    await store.setRoot(vaultDir);
    await store.create("Test");
    const r1 = await store.read("Test.md");
    const saved = await store.write("Test.md", "# Geändert\n", r1.revision);
    expect(saved.revision).not.toBe(r1.revision);
    expect(readFileSync(join(vaultDir, "Test.md"), "utf8")).toBe("# Geändert\n");
    // Alte Revision nach der Änderung → 409, kein stiller Verlust.
    await expect(store.write("Test.md", "# Nochmal\n", r1.revision)).rejects.toMatchObject({ status: 409 });
    await expect(store.write("bild.png", "x", r1.revision)).rejects.toMatchObject({ status: 422 });
  });

  it("Containment: Traversal und Symlink-Ausbruch blockiert", async () => {
    const { store, vaultDir, other } = setup();
    await store.setRoot(vaultDir);
    writeFileSync(join(other, "geheim.md"), "# G\n");
    symlinkSync(other, join(vaultDir, "ausbruch"));
    await expect(store.read("../anders/geheim.md")).rejects.toMatchObject({ status: 422 });
    await expect(store.read("ausbruch/geheim.md")).rejects.toMatchObject({ status: 422 });
    expect((await store.list()).files.some((f) => f.path.includes("ausbruch"))).toBe(false);
    rmSync(join(vaultDir, "ausbruch"), { recursive: true, force: true });
  });

  it("browse: Startpunkte ohne Pfad, eine Ebene Ordner mit Pfad, außerhalb abgelehnt", async () => {
    const { base, store, vaultDir } = setup();
    const start = await store.browse(null);
    expect(start.roots.map((r) => r.name)).toEqual(["projekte", "mein-vault"]);

    mkdirSync(join(vaultDir, "ordner"));
    const inVault = await store.browse(vaultDir);
    expect(inVault.dirs).toEqual([{ name: "ordner", path: join(vaultDir, "ordner") }]);
    expect(inVault.parent).toBe(base);
    const tmp = mkdtempSync(join(tmpdir(), "av-p49-out-"));
    try {
      await expect(store.browse(tmp)).rejects.toMatchObject({ status: 422 });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("Fehlerobjekt trägt HTTP-Status", () => {
    const err = new VaultError("x", 409);
    expect(err.status).toBe(409);
    expect(err.message).toBe("x");
  });
});
