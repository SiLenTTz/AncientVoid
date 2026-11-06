import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { WORKSPACE_MANIFEST_FILENAME, WORKSPACE_MANIFEST_MAX_BYTES } from "@ancientvoid/contracts";
import { resolveManifest, sha256 } from "../../../src/modules/workspace/manifest-resolver.ts";

const execFileAsync = promisify(execFile);

/** Repo mit einem Commit; optional Manifest-Inhalt davor committet. */
async function repoWithManifest(tag: string, manifest: string | null): Promise<{ repo: string; baseSha: string }> {
  const repo = await mkdtemp(join(tmpdir(), `ancientvoid-p29res-${tag}-`));
  await execFileAsync("git", ["-C", repo, "init", "-q", "-b", "main"]);
  await execFileAsync("git", ["-C", repo, "config", "user.email", "t@ancientvoid.local"]);
  await execFileAsync("git", ["-C", repo, "config", "user.name", "ancientvoid test"]);
  await writeFile(join(repo, "a.txt"), "hi\n"); // jedes Repo hat einen Commit
  if (manifest !== null) await writeFile(join(repo, WORKSPACE_MANIFEST_FILENAME), manifest);
  await execFileAsync("git", ["-C", repo, "add", "-A"]);
  await execFileAsync("git", ["-C", repo, "commit", "-q", "-m", "initial"]);
  const { stdout } = await execFileAsync("git", ["-C", repo, "rev-parse", "HEAD"]);
  return { repo, baseSha: stdout.trim() };
}

const VALID = JSON.stringify({ schemaVersion: 1, include: [".env"] });

describe("EPIC-P29 T29.2: resolveManifest (ADR-0051 §2)", () => {
  it("fehlendes Manifest ist kein Fehler, sondern der alte T2.1-Pfad", async () => {
    const { repo, baseSha } = await repoWithManifest("none", null);
    try {
      expect(await resolveManifest(repo, baseSha)).toEqual({ status: "none" });
      expect(await resolveManifest(repo, null)).toEqual({ status: "none" }); // kein Git/keine Basis-SHA
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it("gültiges Manifest: geparst und mit sha256 des exakten Inhalts gehasht", async () => {
    const { repo, baseSha } = await repoWithManifest("ok", VALID);
    try {
      const resolved = await resolveManifest(repo, baseSha);
      expect(resolved).toMatchObject({ status: "ok", manifestHash: sha256(VALID) });
      if (resolved.status === "ok") expect(resolved.manifest.include).toEqual([".env"]);
      // unabhängig nachgerechnet, nicht nur mit der eigenen Funktion verglichen:
      expect(resolved.status === "ok" ? resolved.manifestHash : "").toBe(createHash("sha256").update(VALID).digest("hex"));
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it("ungültige schemaVersion failt laut mit benannter Ursache", async () => {
    const { repo, baseSha } = await repoWithManifest("v2", JSON.stringify({ schemaVersion: 2 }));
    try {
      const resolved = await resolveManifest(repo, baseSha);
      expect(resolved.status).toBe("invalid");
      if (resolved.status === "invalid") expect(resolved.reason).toContain("schemaVersion");
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it("kaputtes JSON und unbekannte Felder failen laut", async () => {
    const broken = await repoWithManifest("json", "{not json");
    const unknown = await repoWithManifest("field", JSON.stringify({ schemaVersion: 1, env: {} }));
    try {
      expect((await resolveManifest(broken.repo, broken.baseSha)).status).toBe("invalid");
      expect((await resolveManifest(unknown.repo, unknown.baseSha)).status).toBe("invalid");
    } finally {
      await rm(broken.repo, { recursive: true, force: true });
      await rm(unknown.repo, { recursive: true, force: true });
    }
  });

  it("liest an der Basis-SHA: Änderungen im Arbeitsverzeichnis wechseln das Verhalten nicht unbemerkt", async () => {
    const { repo, baseSha } = await repoWithManifest("pin", VALID);
    try {
      const tampered = JSON.stringify({ schemaVersion: 1, include: [".env", "config/prod.yaml"] });
      await writeFile(join(repo, WORKSPACE_MANIFEST_FILENAME), tampered); // uncommittet verdreht
      const resolved = await resolveManifest(repo, baseSha);
      expect(resolved).toMatchObject({ status: "ok", manifestHash: sha256(VALID) });
      if (resolved.status === "ok") expect(resolved.manifest.include).toEqual([".env"]);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it("übergroßes Manifest (> 64 KiB) wird abgelehnt, nicht geraten", async () => {
    const huge = JSON.stringify({ schemaVersion: 1, include: [".env"], comment: "x".repeat(WORKSPACE_MANIFEST_MAX_BYTES) });
    const { repo, baseSha } = await repoWithManifest("huge", huge);
    try {
      const resolved = await resolveManifest(repo, baseSha);
      expect(resolved.status).toBe("invalid");
      if (resolved.status === "invalid") expect(resolved.reason).toContain("Byte");
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});
