import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync, strToU8 } from "fflate";
import { listZip, officeSections } from "../../../src/modules/code/formats.ts";

const dir = () => mkdtempSync(join(tmpdir(), "av-p46f-"));

describe("Archiv- und Office-Ansicht (ADR-0058 §8)", () => {
  it("listZip listet Einträge ohne zu entpacken", async () => {
    const d = dir();
    writeFileSync(join(d, "a.zip"), zipSync({ "x.txt": strToU8("hallo"), "sub/y.txt": strToU8("welt") }));
    const res = await listZip(d, "a.zip");
    expect(res.ok && res.entries.map((e) => e.name).sort()).toEqual(["sub/y.txt", "x.txt"]);
  });

  it("listZip: kaputtes Archiv wird benannt, nicht geraten", async () => {
    const d = dir();
    writeFileSync(join(d, "a.zip"), "kein zip");
    const res = await listZip(d, "a.zip");
    expect(res.ok).toBe(false);
  });

  it("officeSections: Folien als Abschnitte mit Hinweis", async () => {
    const d = dir();
    const slide = (t: string) => `<p:sld><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:sld>`;
    writeFileSync(join(d, "a.pptx"), zipSync({ "ppt/slides/slide1.xml": strToU8(slide("Eins")), "ppt/slides/slide2.xml": strToU8(slide("Zwei")) }));
    const res = await officeSections(d, "a.pptx");
    expect(res.ok && res.sections.length).toBe(2);
    expect(res.ok && res.note).toMatch(/Textauszug/);
  });
});
