import { describe, expect, it } from "vitest";
import { parseMarkdown, parseInline } from "../../src/shared/markdown.ts";

describe("parseMarkdown (BUG-0067)", () => {
  it("Überschriften, Absätze und Trennlinien", () => {
    expect(parseMarkdown("## Stand\n\nZeile eins\nZeile zwei\n\n---")).toEqual([
      { kind: "heading", level: 2, content: [{ kind: "text", text: "Stand" }] },
      { kind: "paragraph", lines: [[{ kind: "text", text: "Zeile eins" }], [{ kind: "text", text: "Zeile zwei" }]] },
      { kind: "rule" },
    ]);
  });

  it("Code-Blöcke bleiben wörtlich, auch mit Markdown darin", () => {
    expect(parseMarkdown("```text\nBug: **nicht fett**\n# keine Überschrift\n```")).toEqual([
      { kind: "code", lang: "text", text: "Bug: **nicht fett**\n# keine Überschrift" },
    ]);
  });

  it("ein nicht geschlossener Code-Block läuft bis zum Ende (Streaming, abgeschnittene Antwort)", () => {
    expect(parseMarkdown("```\na\nb")).toEqual([{ kind: "code", lang: "", text: "a\nb" }]);
  });

  it("Listen, nummeriert und verschachtelt", () => {
    const blocks = parseMarkdown("1. **Fix:** eins\n2. zwei\n   - innen\n3. drei");
    expect(blocks).toHaveLength(1);
    const list = blocks[0]!;
    expect(list).toMatchObject({ kind: "list", ordered: true, start: 1 });
    if (list.kind !== "list") throw new Error();
    expect(list.items).toHaveLength(3);
    expect(list.items[0]!.content[0]).toEqual({ kind: "strong", children: [{ kind: "text", text: "Fix:" }] });
    expect(list.items[1]!.children).toEqual([{ kind: "list", ordered: false, start: 1, items: [{ content: [{ kind: "text", text: "innen" }], children: [] }] }]);
  });

  it("Tabellen mit Kopfzeile", () => {
    expect(parseMarkdown("| Feld | Wert |\n|---|---|\n| Commit | `43f43d0` |")).toEqual([
      {
        kind: "table",
        head: [[{ kind: "text", text: "Feld" }], [{ kind: "text", text: "Wert" }]],
        rows: [[[{ kind: "text", text: "Commit" }], [{ kind: "code", text: "43f43d0" }]]],
      },
    ]);
  });

  it("Zitate", () => {
    expect(parseMarkdown("> Achtung\n> zweite")).toEqual([
      { kind: "quote", blocks: [{ kind: "paragraph", lines: [[{ kind: "text", text: "Achtung" }], [{ kind: "text", text: "zweite" }]] }] },
    ]);
  });
});

describe("parseInline (BUG-0067)", () => {
  it("fett, kursiv, durchgestrichen, Inline-Code", () => {
    expect(parseInline("a **b** *c* ~~d~~ `e*f*`")).toEqual([
      { kind: "text", text: "a " },
      { kind: "strong", children: [{ kind: "text", text: "b" }] },
      { kind: "text", text: " " },
      { kind: "em", children: [{ kind: "text", text: "c" }] },
      { kind: "text", text: " " },
      { kind: "del", children: [{ kind: "text", text: "d" }] },
      { kind: "text", text: " " },
      { kind: "code", text: "e*f*" },
    ]);
  });

  it("Unterstriche in Bezeichnern sind kein Kursiv", () => {
    expect(parseInline("snake_case_name und file_path")).toEqual([{ kind: "text", text: "snake_case_name und file_path" }]);
  });

  it("Links nur für http(s) und mailto, nackte URLs werden verlinkt", () => {
    expect(parseInline("[MR](https://gitlab.com/x/-/merge_requests/1) und https://a.b/c.")).toEqual([
      { kind: "link", href: "https://gitlab.com/x/-/merge_requests/1", children: [{ kind: "text", text: "MR" }] },
      { kind: "text", text: " und " },
      { kind: "link", href: "https://a.b/c", children: [{ kind: "text", text: "https://a.b/c" }] },
      { kind: "text", text: "." },
    ]);
  });

  it("Prompt-Injection-Grenze: javascript-Links und HTML bleiben Text", () => {
    expect(parseInline("[klick](javascript:alert(1))")).toEqual([{ kind: "text", text: "[klick](javascript:alert(1))" }]);
    expect(parseInline("<img src=x onerror=alert(1)>")).toEqual([{ kind: "text", text: "<img src=x onerror=alert(1)>" }]);
  });

  it("ein einzelnes Sternchen bleibt stehen", () => {
    expect(parseInline("2 * 3 = 6")).toEqual([{ kind: "text", text: "2 * 3 = 6" }]);
  });
});
