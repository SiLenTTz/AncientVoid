import { describe, expect, it } from "vitest";
import {
  MAX_WORKSPACE_DETAIL_CHARS,
  WORKSPACE_EVENT_KINDS,
  WORKSPACE_FAILURE_KINDS,
  WORKSPACE_OWNERSHIP_ENV,
  WORKSPACE_PHASES,
  WORKSPACE_PREVIEW_MAX_PENDING_TICKETS,
  WORKSPACE_PREVIEW_PROXY_TIMEOUT_MS,
  WORKSPACE_PREVIEW_TICKET_TTL_MS,
  WORKSPACE_PREVIEW_MAX_BYTES,
  WORKSPACE_PROXY_PATH,
  WORKSPACE_LOGS_TAIL_CHARS,
  WORKSPACE_SERVICE_STATES,
  WORKSPACE_TEARDOWN_PHASES,
  WorkspaceFailure,
  WorkspacePreviewTicket,
  WorkspaceServiceLogs,
  WorkspaceSetupApproval,
  workspacePreviewTicketPath,
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
    expect(workspacePreviewTicketPath("s1", "web")).toBe("/api/sessions/s1/workspace/services/web/preview-ticket");
    expect(WORKSPACE_PROXY_PATH).toBe("/api/sessions/:id/workspace/services/:serviceId/proxy");
  });

  it("T29.6: Preview-Ticket ist kurzlebig, begrenzt und nackter JSON-Text — Logs gekappt (K5)", () => {
    expect(WORKSPACE_PREVIEW_TICKET_TTL_MS).toBeLessThanOrEqual(5 * 60_000);
    expect(WORKSPACE_PREVIEW_MAX_PENDING_TICKETS).toBeLessThanOrEqual(128);
    expect(WORKSPACE_PREVIEW_PROXY_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
    expect(WORKSPACE_PREVIEW_MAX_BYTES).toBeLessThanOrEqual(64 * 1024 * 1024);
    expect(WORKSPACE_LOGS_TAIL_CHARS).toBeLessThanOrEqual(16_000);
    // Ticket-Payload: nichts außer dem Ticket selbst und dem Ablauf — keine
    // Ziel-URL, kein Feld, über das ein Client den Proxy diverted.
    expect(WorkspacePreviewTicket.safeParse({ ticket: "t".repeat(43), expiresAt: Date.now() + 1000 }).success).toBe(true);
    expect(WorkspacePreviewTicket.safeParse({ ticket: "t", expiresAt: 1, target: "http://127.0.0.1:9/" }).success).toBe(false);
    expect(WorkspaceServiceLogs.safeParse({ serviceId: "web", tail: "zeile\n", truncated: false, updatedAt: "2026-11-07T10:00:00Z" }).success).toBe(true);
    expect(WorkspaceServiceLogs.safeParse({ serviceId: "web", tail: "x".repeat(WORKSPACE_LOGS_TAIL_CHARS + 1), truncated: true, updatedAt: "2026-11-07T10:00:00Z" }).success).toBe(false);
  });

  it("Ownership-Umgebungsmarker ist benannt (Prozess-Eigentum, nicht Portnummer)", () => {
    expect(WORKSPACE_OWNERSHIP_ENV).toBe("ANCIENTVOID_WORKSPACE_SESSION_ID");
  });
});
