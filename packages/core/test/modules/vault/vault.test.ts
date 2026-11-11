import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { VaultError, VaultStore, type VaultStoreIo } from "../../../src/modules/vault/store.ts";
import { VAULT_MAX_LIST } from "@ancientvoid/contracts";

const temporaryDirs: string[] = [];
afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup() {
  const base = mkdtempSync(join(tmpdir(), "av-p49-"));
  temporaryDirs.push(base);
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

  it("P51 setRoot: auch außerhalb der Startpunkte und über einen Symlink; Zustand rekonstruierbar", async () => {
    const { store, vaultDir, other, base, io } = setup();
    const state = await store.setRoot(vaultDir);
    expect(state.configured).toBe(true);
    expect(state.label).toBe("mein-vault");
    symlinkSync(other, join(base, "vault-link"));
    expect((await store.setRoot(join(base, "vault-link"))).root).toBe(other);
    expect(new VaultStore(io).state()).toEqual(store.state());
    expect((await store.browse(null)).roots).toContainEqual({ name: "anders", path: other });
    mkdirSync(join(other, "unter"));
    expect((await store.browse(other)).dirs).toEqual([{ name: "unter", path: join(other, "unter") }]);
    expect((await store.browse(join(other, "unter"))).path).toBe(join(other, "unter"));
    await expect(store.browse(base)).rejects.toMatchObject({ status: 422 });
  });

  it("P51 setRoot: ungültige Ziele tragen Klartext und ändern den gewählten Root nicht", async () => {
    const { store, vaultDir, base } = setup();
    await store.setRoot(vaultDir);
    await expect(store.setRoot(join(base, "fehlt"))).rejects.toMatchObject({ status: 422, message: expect.stringMatching(/nicht gefunden/i) });
    writeFileSync(join(base, "datei.md"), "x");
    await expect(store.setRoot(join(base, "datei.md"))).rejects.toMatchObject({ status: 422, message: expect.stringMatching(/kein Verzeichnis/i) });
    expect(store.state().root).toBe(vaultDir);
  });

  it.skipIf(process.getuid?.() === 0)("P51 setRoot: fehlende Zugriffsrechte werden erklärt, Root bleibt erhalten", async () => {
    const { store, vaultDir, other } = setup();
    await store.setRoot(vaultDir);
    chmodSync(other, 0o000);
    try {
      await expect(store.setRoot(other)).rejects.toMatchObject({ status: 422, message: expect.stringMatching(/Zugriffsrechte/) });
      expect(store.state().root).toBe(vaultDir);
    } finally {
      chmodSync(other, 0o700);
    }
  });

  it("P51 setRoot: Dateisystemwurzel bleibt ein gültiger Root mit korrekten relativen Dateipfaden", async () => {
    const { store, vaultDir } = setup();
    writeFileSync(join(vaultDir, "notiz.md"), "# Wurzel\n");
    await store.setRoot(sep);
    expect((await store.read(relative(sep, join(vaultDir, "notiz.md")))).text).toBe("# Wurzel\n");
  });

  it("setRoot: dataDir des Hubs und .git-Inneres abgelehnt", async () => {
    const { base, store, vaultDir } = setup();
    await expect(store.setRoot(join(base, "hub-data"))).rejects.toThrow(/Datenverzeichnis/);
    mkdirSync(join(vaultDir, ".git"), { recursive: true });
    await expect(store.setRoot(join(vaultDir, ".git"))).rejects.toThrow(/\.git/);
    mkdirSync(join(vaultDir, ".git", "objects"));
    mkdirSync(join(base, "hub-data", "blobs"));
    symlinkSync(join(vaultDir, ".git"), join(vaultDir, "git-link"));
    symlinkSync(join(base, "hub-data"), join(vaultDir, "data-link"));
    await expect(store.setRoot(join(vaultDir, "git-link", "objects"))).rejects.toMatchObject({ status: 422, message: expect.stringMatching(/\.git/) });
    await expect(store.setRoot(join(vaultDir, "data-link", "blobs"))).rejects.toMatchObject({ status: 422, message: expect.stringMatching(/Datenverzeichnis/) });
  });

  it("P51 browse/list: Ordner-Symlinks sichtbar, Zyklen und doppelte Ziele nur einmal traversiert", async () => {
    const { store, vaultDir } = setup();
    await store.setRoot(vaultDir);
    const target = join(vaultDir, "z-ziel");
    mkdirSync(target);
    writeFileSync(join(target, "notiz.md"), "# Verlinkt\n");
    symlinkSync(target, join(vaultDir, "a-link"));
    symlinkSync(vaultDir, join(target, "zurueck"));
    symlinkSync(join(vaultDir, "fehlt"), join(vaultDir, "kaputt"));
    const browse = await store.browse(vaultDir);
    expect(browse.dirs.map(d => d.name)).toEqual(["a-link", "z-ziel"]);
    expect((await store.browse(join(vaultDir, "a-link"))).path).toBe(target);
    const listing = await store.list();
    expect(listing.files.map(f => f.path)).toEqual(["a-link/notiz.md"]);
    expect(listing.truncated).toBe(false);
    const read = await store.read("a-link/notiz.md");
    expect(read.text).toBe("# Verlinkt\n");
    await store.write("a-link/notiz.md", "# Geändert\n", read.revision);
    expect(readFileSync(join(target, "notiz.md"), "utf8")).toBe("# Geändert\n");
  });

  it("P51 browse/list: Symlink-Ausbrüche und geschützte Ziele bleiben verborgen", async () => {
    const { store, vaultDir, other, base } = setup();
    await store.setRoot(vaultDir);
    mkdirSync(join(vaultDir, ".git"));
    writeFileSync(join(vaultDir, ".git", "secret.md"), "git");
    writeFileSync(join(other, "secret.md"), "extern");
    symlinkSync(other, join(vaultDir, "ausbruch"));
    symlinkSync(join(vaultDir, ".git"), join(vaultDir, "git-link"));
    symlinkSync(join(base, "hub-data"), join(vaultDir, "data-link"));
    expect((await store.browse(vaultDir)).dirs).toEqual([]);
    await expect(store.browse(join(vaultDir, "ausbruch"))).rejects.toMatchObject({ status: 422 });
    await expect(store.browse(join(vaultDir, "git-link"))).rejects.toMatchObject({ status: 422 });
    expect((await store.list()).files).toEqual([]);
    await expect(store.read("git-link/secret.md")).rejects.toMatchObject({ status: 422 });
    await expect(store.write("ausbruch/secret.md", "x", "x")).rejects.toMatchObject({ status: 422 });
  });

  it("P51 list: Cap bleibt auch bei Ordner-Alias und Zyklus ehrlich", async () => {
    const { store, vaultDir } = setup();
    await store.setRoot(vaultDir);
    const target = join(vaultDir, "z-ziel");
    mkdirSync(target);
    symlinkSync(target, join(vaultDir, "a-link"));
    symlinkSync(vaultDir, join(target, "zurueck"));
    for (let i = 0; i <= VAULT_MAX_LIST; i++) writeFileSync(join(target, `notiz-${i}.md`), "x");
    const listing = await store.list();
    expect(listing.files).toHaveLength(VAULT_MAX_LIST);
    expect(listing.truncated).toBe(true);
    expect(listing.files.every(f => f.path.startsWith("a-link/"))).toBe(true);
    rmSync(join(target, `notiz-${VAULT_MAX_LIST}.md`));
    const exact = await store.list();
    expect(exact.files).toHaveLength(VAULT_MAX_LIST);
    expect(exact.truncated).toBe(false);
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
