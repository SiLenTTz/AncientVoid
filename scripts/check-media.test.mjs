import { execFileSync } from "node:child_process";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkMedia, checkMediaOcr, mediaFiles } from "./check-media.mjs";

/** EPIC-P62 T62.2: jede Regel rot-vor-grün — die Fixtures sind die Negativ-
 *proben, eine leere Fundliste über dem echten Repo die Sanity-Probe. */

let dir;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "check-media-test-"));
  mkdirSync(join(dir, "docs/guide/assets"), { recursive: true });
  mkdirSync(join(dir, "apps/site/assets"), { recursive: true });
  mkdirSync(join(dir, "apps/pwa/public/icons"), { recursive: true });
  mkdirSync(join(dir, "docs/demos"), { recursive: true });
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Minimales 1×1-PNG (IHDR+IDAT+IEND) ohne Textchunks. */
function png(withText = false) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4); // Parser prüft CRC nicht — Platzhalter genügt
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = chunk("IHDR", Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]));
  const idat = chunk("IDAT", Buffer.from([0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01]));
  const iend = chunk("IEND", Buffer.alloc(0));
  const text = withText ? chunk("tEXt", Buffer.from("Comment\0leak")) : Buffer.alloc(0);
  return Buffer.concat([sig, ihdr, idat, iend, text]);
}

describe("check-media — mediaFiles", () => {
  it("erkennt Bild- und verbotene Medien, ignoriert Code/Doku", () => {
    const files = ["a.png", "b.MOV", "c.ts", "d.md", "e.zip"];
    expect(mediaFiles(files).sort()).toEqual(["a.png", "b.MOV", "e.zip"]);
  });
});

describe("check-media — Regeln", () => {
  it("media-type: mp4/mov/gif/zip sind überall rot — außer in Test-Fixtures", () => {
    writeFileSync(join(dir, "docs/guide/assets/demo.mp4"), "x");
    expect(checkMedia(dir, ["docs/guide/assets/demo.mp4"])[0].rule).toBe("media-type");
    // Medienanalyse-Tests brauchen echtes Videomaterial als Fixture.
    expect(checkMedia(dir, ["packages/core/test/fixtures/media/slides.mp4"])).toEqual([]);
  });

  it("media-dir: Bilder außerhalb der erlaubten Orte sind rot, Bestandsorte erlaubt", () => {
    writeFileSync(join(dir, "docs/demos/screenshot.png"), png());
    expect(checkMedia(dir, ["docs/demos/screenshot.png"])[0].rule).toBe("media-dir");
    writeFileSync(join(dir, "apps/pwa/public/icons/icon.png"), png());
    expect(checkMedia(dir, ["apps/pwa/public/icons/icon.png"])).toEqual([]);
  });

  it("media-name: Guide-/Site-Assets heißen <seite>-<nn>.<ext>", () => {
    writeFileSync(join(dir, "docs/guide/assets/Screenshot 2026.png"), png());
    expect(checkMedia(dir, ["docs/guide/assets/Screenshot 2026.png"])[0].rule).toBe("media-name");
    writeFileSync(join(dir, "docs/guide/assets/overview-01.png"), png());
    expect(checkMedia(dir, ["docs/guide/assets/overview-01.png"])).toEqual([]);
  });

  it("media-budget: Datei über 512 KiB ist rot", () => {
    const big = Buffer.concat([png(), Buffer.alloc(513 * 1024)]);
    writeFileSync(join(dir, "docs/guide/assets/big-01.png"), big);
    expect(checkMedia(dir, ["docs/guide/assets/big-01.png"])[0].rule).toBe("media-budget");
  });

  it("media-meta: PNG-Textchunk und SVG-<script> sind rot", () => {
    writeFileSync(join(dir, "docs/guide/assets/meta-01.png"), png(true));
    expect(checkMedia(dir, ["docs/guide/assets/meta-01.png"])[0].rule).toBe("media-meta");
    writeFileSync(join(dir, "docs/guide/assets/evil-01.svg"), "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>");
    expect(checkMedia(dir, ["docs/guide/assets/evil-01.svg"])[0].rule).toBe("media-meta");
    writeFileSync(join(dir, "docs/guide/assets/clean-01.svg"), "<svg xmlns='http://www.w3.org/2000/svg'></svg>");
    expect(checkMedia(dir, ["docs/guide/assets/clean-01.svg"])).toEqual([]);
  });

  it("media-meta: JPEG mit APP1 (EXIF) ist rot", () => {
    // SOI + APP1-Segment mit Exif-Kennung + Rest-Bytes
    const jpg = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      Buffer.from([0xff, 0xe1, 0x00, 0x08]),
      Buffer.from("Exif\x00\x00\x00\x00"),
      Buffer.from([0xff, 0xd9]),
    ]);
    writeFileSync(join(dir, "docs/guide/assets/exif-01.jpg"), jpg);
    expect(checkMedia(dir, ["docs/guide/assets/exif-01.jpg"])[0].rule).toBe("media-meta");
  });
});

const hasTesseract = (() => {
  try {
    execFileSync("tesseract", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe("check-media — OCR (nur wenn tesseract vorhanden)", () => {

  it.skipIf(!hasTesseract)("avt_-Token im Bildtext wird rot", async () => {
    // Kein echtes Rendering nötig: checkMediaOcr startet tesseract nur auf
    // existierenden Dateien — hier ein SVG mit Token im Text.
    writeFileSync(join(dir, "docs/guide/assets/token-01.svg"), "<svg xmlns='http://www.w3.org/2000/svg'><text>avt_ABCDEFGHIJKLMNOPQRSTUVWX</text></svg>");
    const f = await checkMediaOcr(dir, ["docs/guide/assets/token-01.svg"]);
    expect(f.some((x) => x.rule === "media-ocr")).toBe(true);
  });
});
