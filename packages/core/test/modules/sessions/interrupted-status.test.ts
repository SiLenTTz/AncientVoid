import { describe, expect, it } from "vitest";
import { SESSION_STATUSES, SessionStatus } from "@ancientvoid/contracts";
import { VALID_TRANSITIONS } from "../../../src/modules/sessions/session-state.ts";

/** ADR-0044 (EPIC-P27 T27.2): Status `interrupted` — additiv, Übergänge
 * vollständig deklariert, alte Status unangetastet. */
describe("ADR-0044: SessionStatus interrupted", () => {
  it("enum bleibt additiv — alle alten Werte bleiben erhalten", () => {
    expect(SESSION_STATUSES).toContain("interrupted");
    for (const s of [
      "idle",
      "starting",
      "working",
      "waiting_approval",
      "parked",
      "stopping",
      "stopped",
      "error",
    ]) {
      expect(SESSION_STATUSES).toContain(s);
    }
  });

  it("Contract-Parser akzeptiert den Wert (kein zod-Bruch)", () => {
    expect(SessionStatus.safeParse("interrupted").success).toBe(true);
  });

  it("Interrupt-Ziele: working/starting/waiting_approval/parked → interrupted", () => {
    for (const from of ["starting", "working", "waiting_approval", "parked"] as const) {
      expect(VALID_TRANSITIONS[from]).toContain("interrupted");
    }
    // idle hat keinen laufenden Zug, stopping ist bereits terminal unterwegs —
    // beide werden bewusst NICHT unterbrochen.
    expect(VALID_TRANSITIONS.idle).not.toContain("interrupted");
    expect(VALID_TRANSITIONS.stopping).not.toContain("interrupted");
  });

  it("interrupted → working (Resume) | stopping/stopped (Stop/Archiv) | error (Resume scheitert, fail loud)", () => {
    expect(VALID_TRANSITIONS.interrupted).toEqual(["working", "stopping", "stopped", "error"]);
  });

  it("bestehende Übergänge sind unverändert (stopped bleibt reaktivierbar, ADR-0015)", () => {
    expect(VALID_TRANSITIONS.stopped).toEqual(["working"]);
    expect(VALID_TRANSITIONS.error).toContain("working");
  });
});
