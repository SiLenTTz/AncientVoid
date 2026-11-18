import { describe, expect, it } from "vitest";
import { parseCommitNotation } from "../../../src/modules/release-notes/notation.ts";
import { parseShortStat } from "../../../src/modules/release-notes/build.ts";

/** EPIC-P68 (ADR-0089): Commit-Notation als Struktur — echte Formen aus dem
 * eigenen Verlauf, inkl. fail loud für Subjects ohne Notation (PR #150). */
describe("parseCommitNotation (T68.2)", () => {
  it("zerlegt Risiko, Absicht, Bereich, Satz", () => {
    const n = parseCommitNotation("^ F pwa: Einladung als QR-Code anzeigen");
    expect(n).toMatchObject({ risk: "^", intent: "F", area: "pwa", summary: "Einladung als QR-Code anzeigen", prNumber: null, unparsed: false });
  });

  it("erkennt PR-Nummer (#N) am Subject-Ende", () => {
    const n = parseCommitNotation(". d epics: EPIC-P67 T67.1-T67.9 abgeschlossen — Evidenz, AC-Bilanz, T67.10-Uebergabe (#159)");
    expect(n.prNumber).toBe(159);
    expect(n.summary).toBe("EPIC-P67 T67.1-T67.9 abgeschlossen — Evidenz, AC-Bilanz, T67.10-Uebergabe");
    expect(n.unparsed).toBe(false);
  });

  it("Bereich mit Schrägstrich wie `hub/pwa` (PR #155)", () => {
    const n = parseCommitNotation("^ F hub/pwa: Main-Sync-Meldungen mit Aktionsknopf (#155)");
    expect(n.area).toBe("hub/pwa");
  });

  it("alle Risiko- und Absichtzeichen der Notation", () => {
    expect(parseCommitNotation("! B adapter-claude: Rueckfrage beantworten")).toMatchObject({ risk: "!", intent: "B", area: "adapter-claude" });
    expect(parseCommitNotation("@ r core: zwischenstand")).toMatchObject({ risk: "@", intent: "r", area: "core" });
  });

  it("Subject ohne Notation bleibt roh sichtbar (fail loud, nie filtern)", () => {
    const raw = "BUG-0211: der Chat reicht wieder bis zu seinem Anfang (#150)";
    const n = parseCommitNotation(raw);
    expect(n).toMatchObject({ raw, risk: null, intent: null, area: null, summary: raw, prNumber: 150, unparsed: true });
  });

  it("Merge-Subject ohne PR-Nummer ist keine Fehler", () => {
    const n = parseCommitNotation("^ F core: etwas ohne nummer");
    expect(n.prNumber).toBeNull();
    expect(n.unparsed).toBe(false);
  });
});

describe("parseShortStat (T68.2)", () => {
  it("liest Dateien/Insertions/Deletions", () => {
    expect(parseShortStat(" 2 files changed, 62 insertions(+), 12 deletions(-)")).toEqual({ filesChanged: 2, insertions: 62, deletions: 12 });
  });

  it("einzeilig und ohne Deletions", () => {
    expect(parseShortStat("1 file changed, 3 insertions(+)")).toEqual({ filesChanged: 1, insertions: 3, deletions: 0 });
  });

  it("unlesbar → null statt geraten (Binärdateien, leer)", () => {
    expect(parseShortStat("")).toBeNull();
    expect(parseShortStat("kein stat")).toBeNull();
  });
});
