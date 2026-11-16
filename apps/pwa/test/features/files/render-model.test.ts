import { describe, expect, it } from "vitest";
import { guessDelimiter, jsonNodes, parseDelimited, parseInline, parseMarkdown, parseNotebook, safeHref, splitHighlighted } from "../../../src/features/files/render-model.ts";

describe("render-model (ADR-0058 §7–§8)", () => {
  it("splitHighlighted schließt/öffnet Spans an Zeilengrenzen", () => {
    expect(splitHighlighted('<span class="c">a\nb</span>\nc')).toEqual(['<span class="c">a</span>', '<span class="c">b</span>', "c"]);
  });

  it("CSV: Anführungszeichen, Komma und Zeilenumbruch im Feld, CRLF", () => {
    expect(parseDelimited('a,"b,1","x\ny"\r\nc,d,e', ",")).toEqual([["a", "b,1", "x\ny"], ["c", "d", "e"]]);
    expect(guessDelimiter("x.csv", "a;b;c\n1;2;3")).toBe(";");
    expect(guessDelimiter("x.tsv", "a,b")).toBe("\t");
  });

  it("Markdown: gefährliche Links werden zu Text, kein HTML entsteht", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,x")).toBeNull();
    expect(safeHref("//evil.example")).toBeNull();
    expect(safeHref("https://a.example")).toBe("https://a.example");
    expect(parseInline("[x](javascript:alert(1))").every((i) => i.t === "text")).toBe(true);
    const blocks = parseMarkdown("# T\n\n<script>alert(1)</script>\n\n```mermaid\ngraph TD\n```\n\n- a\n- b\n\n| h |\n|---|\n| c |");
    expect(blocks.map((b) => b.t)).toEqual(["heading", "para", "code", "list", "table"]);
    expect(blocks[1]).toMatchObject({ inline: [{ t: "text", text: "<script>alert(1)</script>" }] });
  });

  it("JSON-Baum: begrenzt Breite und liefert Typen", () => {
    const n = jsonNodes({ a: [1, 2], b: "x", c: null }, "$");
    expect(n.children?.map((c) => c.kind)).toEqual(["array", "string", "null"]);
  });

  it("Notebook: Text-/PNG-Ausgaben, HTML-Ausgabe wird nicht gerendert, kaputtes JSON benannt", () => {
    const nb = JSON.stringify({ cells: [
      { cell_type: "code", source: ["print(1)"], outputs: [{ output_type: "stream", text: ["1\n"] }, { output_type: "display_data", data: { "text/html": "<script>x</script>" } }, { output_type: "display_data", data: { "image/png": "iVBORw0KGgo=" } }] },
      { cell_type: "markdown", source: "# Hi" },
    ] });
    const res = parseNotebook(nb);
    expect(res.ok && res.cells[0]!.outputs.map((o) => o.kind)).toEqual(["text", "other", "image"]);
    expect(parseNotebook("{").ok).toBe(false);
  });
});
