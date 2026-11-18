import { describe, expect, it, beforeEach } from "vitest";
import { INTENT_LABEL, notationLine, RISK_LABEL, statsLine, loadReleaseNotesPrefs, saveReleaseNotesPrefs } from "../../../src/features/release-notes/release-notes-model.ts";

/** EPIC-P70 (ADR-0092): Klartext-Labels, Notations-Kurzzeile, Stats-Zeile und
 * die gerätelokale Projekt-Pinne (Muster git-model.ts). */

const page = () => {
  // localStorage existiert im Node-Kontext nicht — minimaler Stub wie im Browser.
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
};

describe("release-notes-model (T70.4)", () => {
  beforeEach(page);

  it("notationLine nennt Risiko · Absicht · Bereich in Klartext", () => {
    expect(notationLine({ raw: "^ F pwa: x", risk: "^", intent: "F", area: "pwa", summary: "x", prNumber: null, unparsed: false })).toBe(
      `${RISK_LABEL["^"]} · ${INTENT_LABEL.F} · pwa`,
    );
    expect(RISK_LABEL["^"]).toBe("geprüft");
    expect(INTENT_LABEL.B).toBe("Bugfix");
  });

  it("Subjects ohne Notation werden als „ohne Notation“ markiert, nie versteckt (fail loud)", () => {
    expect(notationLine({ raw: "BUG-1: x (#2)", risk: null, intent: null, area: null, summary: "BUG-1: x (#2)", prNumber: 2, unparsed: true })).toBe("ohne Notation");
  });

  it("statsLine formuliert Dateien und ±Zeilen; null bleibt leer", () => {
    expect(statsLine({ filesChanged: 2, insertions: 62, deletions: 12 })).toBe("2 Dateien · +62 · −12");
    expect(statsLine({ filesChanged: 1, insertions: 3, deletions: 0 })).toBe("1 Datei · +3 · −0");
    expect(statsLine(null)).toBe("");
  });

  it("Projekt-Wahl überlebt im gerätelokalen Speicher (versioniert)", () => {
    expect(loadReleaseNotesPrefs()).toEqual({ project: null });
    saveReleaseNotesPrefs({ project: "/tmp/proj" });
    expect(loadReleaseNotesPrefs()).toEqual({ project: "/tmp/proj" });
  });

  it("kaputter Speicher fällt auf null zurück, statt zu werfen", () => {
    localStorage.setItem("ancientvoid.releasenotes.v1", "{kein json");
    expect(loadReleaseNotesPrefs()).toEqual({ project: null });
  });
});
