#!/usr/bin/env node
/**
 * EPIC-P62 T62.2 (AC-P62-5): deterministischer Leak-Guard für committete
 * Medien — Struktur immer (offline), Inhalt per --ocr in der CI (tesseract
 * über neue/geänderte Guide-/Site-Screenshots). Regelwerk:
 *
 *   media-type   Video-/Archiv-/Binär-Typen sind im Repo rot (mp4, mov,
 *                gif, zip, …) — YouTube hostet Videos, das Repo nicht.
 *   media-dir    Bildmedien nur an erlaubten Orten: Guide-/Site-Assets
 *                (EPIC-P62) plus Bestandsorte (PWA-Produktassets, Test-
 *                fixtures, alte Doku-Assets) — explizit, nicht geraten.
 *   media-name   Guide-Screenshots heißen <seite>-<nn>.<ext>.
 *   media-budget je Datei ≤ 512 KiB, je erlaubtem Verzeichnis ≤ 24 MiB.
 *   media-meta   PNG-Textchunks und EXIF/XMP müssen leer sein; SVG ohne
 *                <script> (ein Medium trägt keine Heimatkunde).
 *   media-ocr    --ocr: tesseract-Text gegen Token-Muster mit festen
 *                Präfixen (ghp_, github_pat_, sk-, glpat-, avt_, AKIA…,
 *                Private-Key-Blöcke) — Philosophie wie check-secrets.mjs.
 *
 * Tests: scripts/check-media.test.mjs (jede Regel rot-vor-grün dort).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
/** Test-Fixtures dürfen Medienartiges halten (Medienanalyse-Tests brauchen
 * echtes Videomaterial) — veröffentlicht wird davon nichts. */
const TEST_FIXTURE_DIRS = ["packages/core/test/fixtures/", "e2e/fixtures/", "e2e/live/fixtures/"];
/** Erlaubte Bild-Endungen (alles andere Medienartige ist rot). */
const IMAGE_EXTS = ["png", "webp", "jpg", "jpeg", "svg"];
/** Medienartige Typen, die im Repo nichts verloren haben — außer in
 * Test-Fixtures (TEST_FIXTURE_DIRS). */
const BANNED_EXTS = ["mp4", "mov", "avi", "mkv", "webm", "gif", "avif", "zip", "tar", "gz", "7z", "rar", "pdf", "psd", "ai"];
/** Orte, an denen Bildmedien liegen dürfen (Präfixe). */
export const ALLOWED_MEDIA_DIRS = [
  "docs/guide/assets/", // EPIC-P62: Guide-Screenshots (erzeugt, siehe guide-shots)
  "apps/site/assets/", // EPIC-P62: Promo-Seiten-Assets
  "apps/pwa/public/", // Produktassets der PWA (Icons, Nyx)
  "docs/assets/", // Bestand: alte Doku-Grafiken (vor EPIC-P62)
  "docs/mockups/",
  "packages/core/test/fixtures/",
  "e2e/fixtures/",
  "e2e/live/fixtures/",
];
/** Nur hier greifen Name/Budget/Metadata (veröffentlichte Medien). */
export const PUBLISHED_MEDIA_DIRS = ["docs/guide/assets/", "apps/site/assets/"];
const NAME_RE = /^[a-z0-9][a-z0-9-]*-[0-9]{2}\.(png|webp|jpg|jpeg|svg)$/;
const PER_FILE_BYTES = 512 * 1024;
const PER_DIR_BYTES = 24 * 1024 * 1024;

const ext = (f) => f.slice(f.lastIndexOf(".") + 1).toLowerCase();

/** Hoch-Präzisions-Token-Muster (feste Präfixe, keine Heuristik). */
export const OCR_TOKEN_PATTERNS = [
  /ghp_[A-Za-z0-9]{36}/,
  /github_pat_[A-Za-z0-9_]{22,}/,
  /sk-[A-Za-z0-9_-]{20}/,
  /glpat-[A-Za-z0-9_-]{20}/,
  /avt_[A-Za-z0-9_-]{20}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN (RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----/,
];

export function mediaFiles(files) {
  return files.filter((f) => IMAGE_EXTS.includes(ext(f)) || BANNED_EXTS.includes(ext(f)));
}

function pngTextChunks(buf) {
  // PNG: 8-Byte-Signatur, dann Chunks (len u32be, type 4 ASCII, data, crc).
  const kinds = [];
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    if (["tEXt", "iTXt", "zTXt"].includes(type)) kinds.push(type);
    off += 12 + len; // len + type + data + crc
    if (len < 0 || off > buf.length) break;
  }
  return kinds;
}

function jpegAppSegments(buf) {
  const segs = [];
  let off = 2; // SOI
  while (off + 4 <= buf.length && buf[off] === 0xff) {
    const marker = buf[off + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      off += 2;
      continue;
    }
    const len = buf.readUInt16BE(off + 2);
    segs.push(marker);
    if (marker === 0xda) break; // Scan-Daten: Metadaten sind vorbei
    off += 2 + len;
  }
  return segs;
}

function webpChunks(buf) {
  // RIFF....WEBP + Subchunks mit 4-Byte-FourCC.
  const kinds = [];
  if (buf.length < 12 || buf.toString("ascii", 0, 4) !== "RIFF") return ["?"];
  let off = 12;
  while (off + 8 <= buf.length) {
    const fourcc = buf.toString("ascii", off, off + 4);
    const len = buf.readUInt32LE(off + 4);
    kinds.push(fourcc);
    off += 8 + len + (len % 2);
  }
  return kinds;
}

export function checkMedia(root, files) {
  const findings = [];
  const add = (rule, file, detail) => findings.push({ rule, file, detail });

  for (const file of mediaFiles(files)) {
    const e = ext(file);
    if (BANNED_EXTS.includes(e)) {
      if (TEST_FIXTURE_DIRS.some((d) => file.startsWith(d))) continue; // Fixture-Material für Medienanalyse-Tests
      add("media-type", file, `Typ .${e} ist im Repo nicht erlaubt (Videos hostet YouTube, Rohmaterial bleibt draußen)`);
      continue;
    }
    if (BANNED_EXTS.includes(e)) {
      add("media-type", file, `Typ .${e} ist im Repo nicht erlaubt (Videos hostet YouTube, Rohmaterial bleibt draußen)`);
      continue;
    }
    if (!ALLOWED_MEDIA_DIRS.some((d) => file.startsWith(d))) {
      add("media-dir", file, `Bildmedien nur unter ${ALLOWED_MEDIA_DIRS.join(" / ")}`);
      continue;
    }
    if (!PUBLISHED_MEDIA_DIRS.some((d) => file.startsWith(d))) continue; // Bestand: weiter nur Typ/Ort
    const base = file.split("/").pop() ?? file;
    if (!NAME_RE.test(base)) add("media-name", file, `Guide-/Site-Assets heißen <seite>-<nn>.<ext> (z. B. overview-01.png)`);
    const buf = readFileSync(join(root, file));
    if (buf.length > PER_FILE_BYTES) add("media-budget", file, `${buf.length} B > ${PER_FILE_BYTES} B je Datei`);
    if (e === "png") {
      const text = pngTextChunks(buf);
      if (text.length > 0) add("media-meta", file, `PNG-Textchunks gesetzt: ${text.join(", ")}`);
    } else if (e === "jpg" || e === "jpeg") {
      if (jpegAppSegments(buf).includes(0xe1)) add("media-meta", file, "JPEG APP1 (EXIF/XMP) gesetzt");
    } else if (e === "webp") {
      const chunks = webpChunks(buf);
      if (chunks.includes("EXIF") || chunks.includes("XMP ")) add("media-meta", file, `WebP-Metadaten gesetzt: ${chunks.join(",")}`);
    } else if (e === "svg") {
      if (/<script[\s>]/i.test(buf.toString("utf8"))) add("media-meta", file, "SVG enthält <script>");
    }
  }

  for (const dir of PUBLISHED_MEDIA_DIRS) {
    const total = files
      .filter((f) => f.startsWith(dir) && IMAGE_EXTS.includes(ext(f)))
      .reduce((sum, f) => sum + readFileSync(join(root, f)).length, 0);
    if (total > PER_DIR_BYTES) add("media-budget", dir, `${total} B > ${PER_DIR_BYTES} B gesamt`);
  }
  return findings;
}

/** --ocr: tesseract über die Dateien, die `pick` liefert (CI: neue/geänderte). */
export function checkMediaOcr(root, files, pick = (f) => PUBLISHED_MEDIA_DIRS.some((d) => f.startsWith(d)) && IMAGE_EXTS.includes(ext(f))) {
  const findings = [];
  for (const file of files.filter(pick)) {
    let text;
    try {
      text = execFileSync("tesseract", [join(root, file), "stdout", "-l", "eng"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      findings.push({ rule: "media-ocr", file, detail: "tesseract nicht verfügbar/lauffähig" });
      continue;
    }
    for (const re of OCR_TOKEN_PATTERNS) {
      const hit = re.exec(text);
      if (hit) findings.push({ rule: "media-ocr", file, detail: `Token-Muster getroffen: ${hit[0].slice(0, 8)}…` });
    }
  }
  return findings;
}

if (process.argv[1]?.endsWith("check-media.mjs")) {
  const root = process.argv[2] === "--staged" || process.argv[2] === "--ocr" ? "." : (process.argv[2] ?? ".");
  const ocr = process.argv.includes("--ocr");
  // --staged (pre-commit): nur gestellte Dateien, Strukturregeln, kein OCR —
  // der Inhalt bleibt der CI überlassen, der Hook bleibt schnell.
  const staged = process.argv.includes("--staged");
  const files = staged
    ? execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACR"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean)
    : execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
  const findings = checkMedia(root, files);
  if (ocr && !staged) {
    let base = null;
    try {
      base = execFileSync("git", ["merge-base", "HEAD", "origin/main"], { cwd: root, encoding: "utf8" }).trim();
    } catch {
      // kein origin/main (Kaltstand) — dann alle Guide-/Site-Medien
    }
    const changed = base
      ? execFileSync("git", ["diff", "--name-only", base, "HEAD"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean)
      : files;
    findings.push(...checkMediaOcr(root, changed));
  }
  for (const f of findings) console.error(`FAIL ${f.rule} ${f.file}: ${f.detail}`);
  if (findings.length > 0) process.exit(1);
  console.log(staged ? "check:media (staged) — Medien-Regeln eingehalten" : "check:media — Medien-Regeln eingehalten");
}
