import { describe, expect, it, vi } from "vitest";
import { zipSync, strToU8 } from "fflate";
import type * as realFflate from "fflate";

/**
 * BUG-0109: officeText() rief unzipSync() ohne Filter und ohne Limit — die
 * 25-MB-Obergrenze galt nur für die komprimierte Datei, nicht für die
 * Entpackmenge. Ein 4,9-MB-DOCX mit zwölf 400-MB-Füll-Einträgen hob den RSS
 * des laufenden Hubs auf ~4,9 GB. Erwartet: nur die Parts, die officeText
 * wirklich liest, werden entpackt — und diese sind betragsbegrenzt.
 */

// fflate mockt, um zu sehen, WAS entpackt wird: ohne Filter (Alter Stand)
// gibt unzipSync alle Einträge zurück — der Rumpfel wird infliert (rot);
// mit Filter fehlt er im Ergebnis (grün).
vi.mock("fflate", async (importOriginal) => {
  const real = await importOriginal<typeof realFflate>();
  return {
    ...real,
    unzipSync: (data: Uint8Array, opts?: Parameters<typeof real.unzipSync>[1]) => {
      const result = real.unzipSync(data, opts);
      calls.push(opts ? "opts" : "no-opts");
      filtered.push(Object.keys(result));
      return result;
    },
  };
});

const calls: string[] = [];
const filtered: string[][] = [];
const { officeText } = await import("../../../src/modules/attachments/extract.ts");

describe("officeText decompression guard (BUG-0109)", () => {
  it("passes a filter to unzipSync so unneeded entries are never inflated", () => {
    const zip = zipSync({
      "word/document.xml": strToU8("<w:document><w:p><w:t>hallo</w:t></w:p></w:document>"),
      "junk/big.bin": new Uint8Array(2 * 1024 * 1024).fill(65), // füllt nur, wenn entpackt
    });
    expect(officeText(zip, "dok.docx")).toContain("hallo");
    expect(calls.at(-1)).toBe("opts"); // ohne Fix: "no-opts" — alles wird entpackt
    expect(filtered.at(-1)).toEqual(["word/document.xml"]); // ohne Fix: auch junk/big.bin
  });

  it("a needed entry beyond the size limit fails loudly instead of inflating unbounded", () => {
    const zip = zipSync({ "word/document.xml": new Uint8Array(200 * 1024 * 1024).fill(65) });
    expect(() => officeText(zip, "dok.docx")).toThrow(/limit/i); // ohne Fix: kommt als 200-MB-String zurück
  });
});
