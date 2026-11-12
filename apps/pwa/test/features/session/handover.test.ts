import { describe, expect, it } from "vitest";
import type { NormalizedEvent } from "../../../src/shared/ws.ts";
import { currentProviderFailure, HANDOVER_CATEGORIES } from "../../../src/features/session/handover.ts";

let seq = 0;
const ev = (type: NormalizedEvent["type"], payload: Record<string, unknown>, summary = type): NormalizedEvent => ({
  seq: ++seq, ts: "2026-11-12T10:00:00.000Z", sessionId: "s1", type, summary, payload, blobRef: null,
});

describe("currentProviderFailure (BUG-0123: auch verlorene Provider-Sessions)", () => {
  it("erkennt eine tote native ID am session.start_failed-Text", () => {
    seq = 0;
    const failure = currentProviderFailure([
      ev("user", { kind: "session.prompt", text: "Bitte setze die unterbrochene Arbeit fort." }),
      ev("system", { kind: "session.start_failed", error: "Resource not found: not found: CgwwyS3Xtsp6JntW2hnPw" }),
    ]);
    expect(failure).toMatchObject({ category: "session", title: "Provider-Session verloren" });
    expect(failure!.detail).toContain("CgwwyS3Xtsp6JntW2hnPw");
    expect(HANDOVER_CATEGORIES.has(failure!.category)).toBe(true);
  });

  it("erkennt den Kontextverlust des Adapters (acp.context_lost)", () => {
    seq = 0;
    const failure = currentProviderFailure([
      ev("user", { kind: "session.prompt", text: "weiter" }),
      ev("system", { kind: "acp.context_lost", lostSessionId: "acp_lost_1", cause: "Resource not found: not found: acp_lost_1" }, "maki: Session acp_lost… beim Agenten nicht mehr vorhanden — neuer Kontext"),
    ]);
    expect(failure).toMatchObject({ category: "session" });
  });

  it("start_failed ohne verlorene Session bleibt kein Handover-Grund", () => {
    seq = 0;
    const failure = currentProviderFailure([
      ev("user", { kind: "session.prompt", text: "repro" }),
      ev("system", { kind: "session.start_failed", error: "File not found: /tmp/fehlt.txt" }),
    ]);
    expect(failure).toBeNull();
  });

  it("eine Antwort nach dem Verlust nimmt die Leiste weg", () => {
    seq = 0;
    const failure = currentProviderFailure([
      ev("user", { kind: "session.prompt", text: "weiter" }),
      ev("system", { kind: "acp.context_lost", lostSessionId: "x" }),
      ev("assistant", { text: "Welche Arbeit?" }),
    ]);
    expect(failure).toBeNull();
  });
});
