import { describe, expect, it } from "vitest";
import { checkSubject } from "./commit-notation.mjs";

describe("commit notation (docs/commit-notation.md)", () => {
  it("accepts risk, intention, area and sentence", () => {
    for (const s of ["^ F pwa: Einladung als QR-Code", ". d adr: ADR-0019", "! B core: Rückfrage nach Neustart (BUG-0029)", "@ r core/sessions: Zwischenstand", "^ m epic-p7: T7.1"]) {
      expect(checkSubject(s), s).toBeNull();
    }
  });

  it("rejects conventional commits, unknown intentions and missing areas", () => {
    for (const s of ["feat(pwa): x", "^ X pwa: y", "^ F Einladung ohne Bereich", "^F pwa: kein Leerzeichen", "? F pwa: falsches Risiko", "^ f pwa: klein ist kein Feature"]) {
      expect(checkSubject(s), s).not.toBeNull();
    }
  });

  it("lets git's own helper subjects through", () => {
    expect(checkSubject("fixup! ^ F pwa: x")).toBeNull();
    expect(checkSubject("Merge branch 'main' into feat/x")).toBeNull();
  });
});
