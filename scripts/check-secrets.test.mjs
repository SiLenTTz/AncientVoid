import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Buffer } from "node:buffer";
import { scanText, scanFiles } from "./check-secrets.mjs";

// AC-P1-6 (AI-P1-2): Der Secret-Scanner selbst ist getestet — jede Regel
// findet ihren gepflanzten Fake, harmloser Text und Doku-Regex-Literale
// lösen nichts aus. Rot-vorhanden gilt hier fürs Gate: verschwindet eine
// Regel, schlägt ihr positiver Fall.

const FAKES = {
  // Konkatenation statt Literal: Ein vollständiger PEM-Header im Quelltext
  // würde den eigenen Repo-Scan auslösen (der OPENSSH-Header ist der eine
  // Allowlist-Eintrag für den gepflanzten getrackten Fake).
  "private-key": "-----BEGIN RSA " + "PRIVATE KEY-----",
  "github-pat": "ghp_" + "a".repeat(36),
  "gitlab-pat": "glpat-" + "ab12cd34ef56gh78ij90",
  "openai-key": "sk-" + "p".repeat(40),
  "anthropic-key": "sk-ant-api03-" + "c".repeat(60),
  "aws-access-key": "AKIA" + "ABCDEFGH12345678".slice(0, 16),
  "google-api-key": "AIza" + "z".repeat(35),
  "slack-token": "xoxb-" + "1234567890abcdef",
};

describe("check-secrets — Regeln", () => {
  for (const [rule, fake] of Object.entries(FAKES)) {
    it(`findet ${rule}`, () => {
      const lines = [ "// Kommentar", `const token = "${fake}";` ];
      const findings = scanText((i) => lines[i] ?? "", lines.length, "x.ts");
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ file: "x.ts", line: 2, rule });
      // Der Secret-Text wird nie vollständig reproduziert.
      expect(findings[0].preview.endsWith("…")).toBe(true);
    });
  }

  it("mehrere Funde in einer Zeile und über Zeilen hinweg", () => {
    const lines = [ `a ${FAKES["github-pat"]} b`, "langweilig", FAKES["gitlab-pat"] ];
    const findings = scanText((i) => lines[i] ?? "", lines.length, "x");
    expect(findings.map((f) => f.rule)).toEqual(["github-pat", "gitlab-pat"]);
  });
});

describe("check-secrets — keine False Positives auf bekanntem Muster", () => {
  const benign = [
    'const token = "geheim";',
    'expect(settings).not.toMatch(/AIza[0-9A-Za-z_-]{20,}/); // Regex-Literal, kein Wert',
    '"sk-test" ist zu kurz, um ein echter Key zu sein',
    "glpat- (Präfix ohne Wert)",
    "AKIA gefolgt von Prosa statt 16 Großbuchstaben-Ziffern-Zeichen",
    "-----BEGIN CERTIFICATE----- ist kein Private Key",
  ];
  for (const [i, line] of benign.entries()) {
    it(`Zeile ${i + 1} löst nichts aus`, () => {
      expect(scanText(() => line, 1, "y.ts")).toEqual([]);
    });
  }
});

describe("check-secrets — scanFiles", () => {
  it("überspringt ausdrücklich erlaubte Werte (Allowlist)", () => {
    // Der einzige Allowlist-Eintrag — rot, wenn jemand die Allowlist still
    // aushöhlt (dann findet der Scanner den getrackten Test-Fake wieder).
    const lines = ['const k = "-----BEGIN OPENSSH PRIVATE KEY-----";'];
    expect(scanText((i) => lines[i] ?? "", lines.length, "fake.ts")).toEqual([]);
  });

  it("findet einen gepflanzten Key in einer echten Datei, überspringt Binärdateien", async () => {
    const dir = await mkdtemp(join(tmpdir(), "av-secrets-"));
    try {
      const good = join(dir, "ok.ts");
      const bad = join(dir, "bad.ts");
      const bin = join(dir, "blob.bin");
      await writeFile(good, "export const x = 1;\n");
      await writeFile(bad, `const k = "${FAKES["gitlab-pat"]}";\n`);
      await writeFile(bin, Buffer.from([0x00, 0x01, 0x02, ...Buffer.from(FAKES["google-api-key"])]));
      const findings = await scanFiles([good, bad, bin]);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ file: bad, line: 1, rule: "gitlab-pat" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("unas lesbare (mittlerweile gelöschte) Datei wirft nicht", async () => {
    expect(await scanFiles([join(tmpdir(), "gibt-es-nicht-xyz.ts")])).toEqual([]);
  });
});
