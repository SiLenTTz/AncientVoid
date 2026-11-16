import { describe, expect, it } from "vitest";
import { reconcile } from "../../src/features/session/draft.ts";

const server = (text: string, revision: number) => ({ sessionId: "s", text, attachmentIds: [], revision, updatedAt: "x", device: "pc" });

describe("draft reconcile on open (T8.4, ADR-0025)", () => {
  it("no local edits: the hub's draft wins", () => {
    expect(reconcile(null, server("vom PC", 3))).toMatchObject({ text: "vom PC", revision: 3, push: false, conflict: null });
    expect(reconcile({ text: "alt", attachmentIds: [], revision: 1, dirty: false }, server("neu", 2))).toMatchObject({ text: "neu", conflict: null });
  });

  it("offline edits on top of the same revision are pushed", () => {
    expect(reconcile({ text: "offline getippt", attachmentIds: [], revision: 2, dirty: true }, server("vorher", 2))).toMatchObject({ text: "offline getippt", push: true, conflict: null });
  });

  it("both changed: mine stays in the field, theirs is shown — nothing overwritten", () => {
    const r = reconcile({ text: "meins", attachmentIds: [], revision: 1, dirty: true }, server("deins", 2));
    expect(r).toMatchObject({ text: "meins", push: false });
    expect(r.conflict?.text).toBe("deins");
  });

  it("hub not reachable: the local copy", () => {
    expect(reconcile({ text: "lokal", attachmentIds: ["a"], revision: 4, dirty: true }, null)).toMatchObject({ text: "lokal", attachmentIds: ["a"], revision: 4 });
  });
});
