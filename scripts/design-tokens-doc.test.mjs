import { describe, expect, it } from "vitest";
import { applyToDoc, parseTokens, renderTable } from "./design-tokens-doc.mjs";

/**
 * BUG-0198: `check:context` meldete auf Windows nach jedem Checkout „Token-Tabelle
 * veraltet“, obwohl der Inhalt stimmte. Der Generator baut die Tabelle mit "\n" und
 * `--check` vergleicht byte-genau — in einem CRLF-Arbeitsverzeichnis (git autocrlf) ist
 * das Ergebnis damit per Definition veraltet, und `docs:design-tokens` mischt LF-Zeilen
 * in ein CRLF-Dokument.
 *
 * Die Probe ist die Invariante, kein Wortlaut-Vergleich: **ein Dokument, dessen
 * Markertabelle bereits dem Generatergebnis entspricht, muss unverändert herauskommen —
 * mit LF wie mit CRLF.**
 */

const css = [
  ":root {",
  "  /* ─── Schicht 1 — primitiv ─── */",
  "  --space-2: 8px;",
  "",
  "  /* ─── Schicht 2 — Semantik ─── */",
  "  --text-sm: 12px;",
  "}",
  "",
].join("\n");

const BEGIN = "<!-- BEGIN:design-tokens (scripts/design-tokens-doc.mjs) -->";
const END = "<!-- END:design-tokens -->";

/** BEGIN/END stecken bereits im Tabellenstück — ein eigenes BEGIN wäre ein doppeltes. */
function docWith(eol) {
  const stueck = renderTable(parseTokens(css)).trimEnd();
  return ["# Design-System", ...stueck.split("\n"), "Fußtext"].join(eol);
}

describe("design-tokens-doc: Zeilenenden des Dokuments bleiben heil (BUG-0198)", () => {
  const table = renderTable(parseTokens(css));

  it("ein LF-Dokument mit frischer Tabelle bleibt unverändert", () => {
    const doc = docWith("\n");
    expect(doc).toContain(BEGIN);
    expect(doc).toContain(END);
    expect(applyToDoc(doc, table)).toBe(doc);
  });

  it("ein CRLF-Dokument mit frischer Tabelle bleibt unverändert — der Windows-Fall", () => {
    const doc = docWith("\r\n");
    expect(applyToDoc(doc, table)).toBe(doc);
  });

  it("ein CRLF-Dokument bleibt frei von gemischten Zeilenenden", () => {
    const out = applyToDoc(docWith("\r\n"), table);
    expect(out).not.toMatch(/[^\r]\n/);
  });

  it("CRLF- und LF-Fassung unterscheiden sich nur in den Zeilenenden", () => {
    expect(applyToDoc(docWith("\r\n"), table).split("\r\n")).toEqual(
      applyToDoc(docWith("\n"), table).split("\n"),
    );
  });

  it("Tokenwerte mit $-Mustern werden nicht als Ersetzungsreferenz gedeutet", () => {
    const stueck = renderTable([{ name: "--merkwuerdig", value: "$&", layer: "primitiv" }]);
    const doc = [BEGIN, "alte Tabelle", END, "Fuß"].join("\n");
    const out = applyToDoc(doc, stueck);
    expect(out).toContain("`$&`");
    expect(out).not.toContain("alte Tabelle");
  });
});
