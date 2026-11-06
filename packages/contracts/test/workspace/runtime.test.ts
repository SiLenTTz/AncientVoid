import { describe, expect, it } from "vitest";
import {
  MAX_WORKSPACE_DETAIL_CHARS,
  WORKSPACE_EVENT_KINDS,
  WORKSPACE_FAILURE_KINDS,
  WORKSPACE_OWNERSHIP_ENV,
  WORKSPACE_PHASES,
  WORKSPACE_PROXY_PATH,
  WORKSPACE_SERVICE_STATES,
  WORKSPACE_TEARDOWN_PHASES,
  WorkspaceFailure,
  WorkspaceSetupApproval,
  workspaceRetryPath,
  workspaceServiceLogsPath,
  workspaceStatusPath,
} from "../../src/workspace/runtime.ts";

const approval = {
  project: "/home/jan/projekt",
  baseSha: "abc123",
  manifestHash: "sha256:…",
  manifest: { schemaVersion: 1, setup: [{ id: "install", argv: ["npm", "install"], timeoutMs: 300_000 }] },
};

describe("EPIC-P29 T29.1: Workspace-Laufzeitvertrag (ADR-0051)", () => {
  it("Zustandsmodell ist fixiert: Laufzeitphasen, Teardown-Phasen, Service-Zustände", () => {
    expect(WORKSPACE_PHASES).toEqual(["preparing", "ready", "failed", "needs_attention"]);
    expect(WORKSPACE_TEARDOWN_PHASES).toEqual(["tearing_down", "archived", "cleanup_failed"]);
    expect(WORKSPACE_SERVICE_STATES).toEqual(["starting", "ready", "failed", "stopped", "probing"]);
  });

  it("alle Event-Kinds leben im workspace.-Namensraum (kein Streufriskiko in session.*/loop.*)", () => {
    expect(WORKSPACE_EVENT_KINDS.length).toBeGreaterThan(0);
    for (const kind of WORKSPACE_EVENT_KINDS) expect(kind.startsWith("workspace.")).toBe(true);
    expect(WORKSPACE_EVENT_KINDS).toContain("workspace.needs_attention");
    expect(WORKSPACE_EVENT_KINDS).toContain("workspace.cleanup_failed");
  });

  it("WorkspaceFailure nennt Schritt und Art, kapselt Details (K5) und verweist Logs als Blob", () => {
    const failure = WorkspaceFailure.parse({ step: "install", kind: "exit", exitCode: 1, logBlobRef: "sha256:abc" });
    expect(failure.logBlobRef).toBe("sha256:abc");
    expect(WorkspaceFailure.parse({ step: "install", kind: "timeout" }).logBlobRef).toBeNull();
    expect(WorkspaceFailure.safeParse({ step: "install", kind: "exit", detail: "x".repeat(MAX_WORKSPACE_DETAIL_CHARS + 1) }).success).toBe(false);
    expect(WorkspaceFailure.safeParse({ step: "x".repeat(81), kind: "exit" }).success).toBe(false);
    expect(WorkspaceFailure.safeParse({ step: "install", kind: "kaputt" }).success).toBe(false);
    expect(WORKSPACE_FAILURE_KINDS).toContain("port");
  });

  it("Freigabe-Payload zeigt das Manifest (Schritte/Include/Services), nie Dateiinhalte", () => {
    expect(WorkspaceSetupApproval.safeParse(approval).success).toBe(true);
    // Kein Feld für Dateiinhalte im Vertrag: ein smuggeltes content-Feld fällt raus/failt.
    expect(WorkspaceSetupApproval.safeParse({ ...approval, includeContent: "SECRET=1" }).success).toBe(false);
  });

  it("API-Pfade folgen dem Session-Routenschema und der Proxy ist auf registrierte Services begrenzt", () => {
    expect(workspaceStatusPath("s1")).toBe("/api/sessions/s1/workspace");
    expect(workspaceRetryPath("s1")).toBe("/api/sessions/s1/workspace/retry");
    expect(workspaceServiceLogsPath("s1", "web")).toBe("/api/sessions/s1/workspace/services/web/logs");
    expect(WORKSPACE_PROXY_PATH).toBe("/api/sessions/:id/workspace/services/:serviceId/proxy");
  });

  it("Ownership-Umgebungsmarker ist benannt (Prozess-Eigentum, nicht Portnummer)", () => {
    expect(WORKSPACE_OWNERSHIP_ENV).toBe("ANCIENTVOID_WORKSPACE_SESSION_ID");
  });
});
