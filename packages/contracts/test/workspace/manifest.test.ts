import { describe, expect, it } from "vitest";
import {
  WorkspaceIncludePath,
  WorkspaceManifest,
  WorkspacePort,
  WorkspaceService,
  WorkspaceStep,
  WORKSPACE_MANIFEST_SCHEMA_VERSION,
} from "../../src/workspace/manifest.ts";

const step = { id: "install", argv: ["npm", "install"], timeoutMs: 300_000 };

describe("EPIC-P29 T29.1: WorkspaceManifest (ADR-0051)", () => {
  it("nimmt ein minimales Manifest an — alles außer schemaVersion ist opt-in", () => {
    expect(WorkspaceManifest.parse({ schemaVersion: 1 })).toEqual({ schemaVersion: 1 });
  });

  it("nimmt ein vollständiges Manifest an (Setup, Teardown, Include inkl. .env, Fixport-Service mit Readiness)", () => {
    const manifest = WorkspaceManifest.parse({
      schemaVersion: 1,
      setup: [step],
      teardown: [{ id: "drop", argv: ["npm", "run", "clean"], timeoutMs: 30_000 }],
      include: [".env", "config/local.json"],
      services: [{ id: "web", argv: ["npm", "run", "dev"], port: 3000, readiness: { path: "/health", timeoutMs: 15_000 } }],
    });
    expect(manifest.services?.[0]?.port).toBe(3000);
  });

  it("lehnt unbekannte schemaVersion und fehlende Version laut ab (fail loud)", () => {
    expect(WorkspaceManifest.safeParse({ schemaVersion: 2 }).success).toBe(false);
    expect(WorkspaceManifest.safeParse({ schemaVersion: "1" }).success).toBe(false);
    expect(WorkspaceManifest.safeParse({ setup: [step] }).success).toBe(false);
  });

  it("lehnt unbekannte Felder ab (strict — kein stilles Ignorieren)", () => {
    const result = WorkspaceManifest.safeParse({ schemaVersion: 1, env: { FOO: "bar" } });
    expect(result.success).toBe(false);
  });

  it("argv ist Programm plus Argumente: leer, leerer String oder Überlänge werden abgelehnt", () => {
    expect(WorkspaceStep.safeParse({ ...step, argv: [] }).success).toBe(false);
    expect(WorkspaceStep.safeParse({ ...step, argv: [""] }).success).toBe(false);
    expect(WorkspaceStep.safeParse({ ...step, argv: ["x".repeat(513)] }).success).toBe(false);
    expect(WorkspaceStep.safeParse({ ...step, argv: Array.from({ length: 65 }, () => "a") }).success).toBe(false);
  });

  it("timeoutMs ist ganze Zahl in [1s, 10min]", () => {
    expect(WorkspaceStep.safeParse({ ...step, timeoutMs: 999 }).success).toBe(false);
    expect(WorkspaceStep.safeParse({ ...step, timeoutMs: 600_001 }).success).toBe(false);
    expect(WorkspaceStep.safeParse({ ...step, timeoutMs: 500.5 }).success).toBe(false);
  });

  it("Include: nur relative, glob-freie Dateipfade — Traversal, absolut, .git/, data/, Globs, Doppelte abgelehnt", () => {
    for (const bad of [
      "/etc/passwd",
      "../secret",
      "a/../../secret",
      "./x",
      "a//b",
      "trailing/",
      "a\\b",
      "src/*.ts",
      "config?.json",
      "[x]/y",
      ".git/config",
      "data/hub.sqlite",
      "",
    ]) {
      expect(WorkspaceIncludePath.safeParse(bad).success, `include soll abgelehnt werden: ${JSON.stringify(bad)}`).toBe(false);
    }
    expect(WorkspaceIncludePath.safeParse(".env").success).toBe(true);
    expect(WorkspaceIncludePath.safeParse("config/local.json").success).toBe(true);
    expect(
      WorkspaceManifest.safeParse({ schemaVersion: 1, include: [".env", ".env"] }).success,
      "doppelte Include-Pfade",
    ).toBe(false);
  });

  it("Port: Fixport nur unprivilegiert gültig, \"auto\" erlaubt, fehlt erlaubt", () => {
    expect(WorkspacePort.safeParse(80).success).toBe(false);
    expect(WorkspacePort.safeParse(65_536).success).toBe(false);
    expect(WorkspacePort.safeParse(1.5).success).toBe(false);
    expect(WorkspacePort.safeParse(3000).success).toBe(true);
    expect(WorkspacePort.safeParse("auto").success).toBe(true);
    expect(WorkspaceService.safeParse({ id: "web", argv: ["a"] }).success).toBe(true);
  });

  it("Readiness-Pfad muss mit / beginnen", () => {
    const base = { id: "web", argv: ["a"] };
    expect(WorkspaceService.safeParse({ ...base, readiness: { path: "health" } }).success).toBe(false);
    expect(WorkspaceService.safeParse({ ...base, readiness: { path: "/health" } }).success).toBe(true);
  });

  it("Schritt- und Service-IDs müssen Slug-Form haben und einmalig sein", () => {
    expect(WorkspaceStep.safeParse({ ...step, id: "2fast" }).success).toBe(false);
    expect(WorkspaceStep.safeParse({ ...step, id: "Install" }).success).toBe(false);
    expect(WorkspaceManifest.safeParse({ schemaVersion: 1, setup: [step, step] }).success).toBe(false);
    expect(
      WorkspaceManifest.safeParse({
        schemaVersion: 1,
        services: [
          { id: "web", argv: ["a"] },
          { id: "web", argv: ["b"] },
        ],
      }).success,
      "doppelte Service-ID",
    ).toBe(false);
  });

  it("Manifest bleibt bei WORKSPACE_MANIFEST_SCHEMA_VERSION 1 (Vertrag versioniert)", () => {
    expect(WORKSPACE_MANIFEST_SCHEMA_VERSION).toBe(1);
  });
});
