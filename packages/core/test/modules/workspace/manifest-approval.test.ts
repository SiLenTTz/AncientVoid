import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HubDatabase } from "../../../src/platform/db.ts";
import { gateManifest, ManifestApprovalStore } from "../../../src/modules/workspace/manifest-approval.ts";
import type { ResolvedManifest } from "../../../src/modules/workspace/manifest-resolver.ts";

const manifest = { schemaVersion: 1 as const, include: [".env"] };
const ok = (hash: string): ResolvedManifest => ({ status: "ok", manifest, manifestHash: hash });

function store(dbFile?: string): { approvals: ManifestApprovalStore; db: HubDatabase } {
  const db = new HubDatabase(dbFile ?? ":memory:");
  return { approvals: new ManifestApprovalStore(db), db };
}

describe("EPIC-P29 T29.2: Hash-Freigabe (ADR-0051 §2)", () => {
  it("ohne Freigabe: approval_required mit dem Anzeige-Payload — nie Dateiinhalte", async () => {
    const { approvals } = store();
    const gate = gateManifest(ok("a".repeat(64)), "/proj", "sha-1", approvals);
    expect(gate).toMatchObject({ ok: false, kind: "approval_required" });
    if (!gate.ok && gate.kind === "approval_required") {
      expect(gate.approval).toEqual({ project: "/proj", baseSha: "sha-1", manifestHash: "a".repeat(64), manifest });
      expect(JSON.stringify(gate.approval)).not.toContain("SECRET");
    }
  });

  it("nach menschlicher Freigabe: gleicher Hash läuft, geänderter Hash braucht neue Zustimmung", () => {
    const { approvals } = store();
    approvals.approve({ project: "/proj", manifestHash: "a".repeat(64), baseSha: "sha-1", approvedBy: "jan" });
    expect(gateManifest(ok("a".repeat(64)), "/proj", "sha-1", approvals).ok).toBe(true);
    // geänderter Manifest-Inhalt ⇒ neuer Hash ⇒ wieder Freigabe nötig
    const changed = gateManifest(ok("b".repeat(64)), "/proj", "sha-1", approvals);
    expect(changed).toMatchObject({ ok: false, kind: "approval_required" });
    // und die Freigabe gilt nur für dieses Projekt
    const otherProject = gateManifest(ok("a".repeat(64)), "/anderes", "sha-1", approvals);
    expect(otherProject).toMatchObject({ ok: false, kind: "approval_required" });
  });

  it("ungültiges Manifest bleibt ungültig — keine Freigabe heilt das", () => {
    const { approvals } = store();
    approvals.approve({ project: "/proj", manifestHash: "a".repeat(64), baseSha: "sha-1", approvedBy: "jan" });
    const gate = gateManifest({ status: "invalid", manifestHash: null, reason: "kaputt" }, "/proj", "sha-1", approvals);
    expect(gate).toMatchObject({ ok: false, kind: "invalid", reason: "kaputt" });
    expect(gateManifest({ status: "none" }, "/proj", null, approvals)).toMatchObject({ ok: false, kind: "invalid" });
  });

  it("Freigaben überleben einen Hub-Neustart (persistente Tabelle, K7-Gefüge)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-p29app-"));
    const dbFile = join(dir, "hub.sqlite");
    try {
      const first = store(dbFile);
      first.approvals.approve({ project: "/proj", manifestHash: "a".repeat(64), baseSha: "sha-1", approvedBy: "jan" });
      first.db.close();
      const second = store(dbFile);
      expect(second.approvals.isApproved("/proj", "a".repeat(64))).toBe(true);
      const listed = second.approvals.list("/proj");
      expect(listed).toHaveLength(1);
      expect(listed[0]).toEqual({
        project: "/proj",
        manifestHash: "a".repeat(64),
        baseSha: "sha-1",
        approvedBy: "jan",
        approvedAt: listed[0]!.approvedAt, // Zeitstempel variiert, Feldnamen nicht
      });
      second.db.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
