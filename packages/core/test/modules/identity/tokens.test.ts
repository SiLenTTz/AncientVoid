import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DISPLAY_ANSWER_CAPABILITY } from "@ancientvoid/contracts";
import { HubDatabase, TokenService } from "../../../src/index.ts";

/** EPIC-P43 T43.10 (ADR-0066): Fähigkeiten hängen am einzelnen Token, Standard aus. */
describe("token capabilities (ADR-0066)", () => {
  it("a token has no capabilities unless they were given at issue", () => {
    const tokens = new TokenService(new HubDatabase(":memory:"));
    const plain = tokens.issue("display:nyx").token;
    const able = tokens.issue("display:kiosk", [DISPLAY_ANSWER_CAPABILITY]).token;
    expect(tokens.identify(plain)).toEqual({ label: "display:nyx", capabilities: [] });
    expect(tokens.identify(able)).toEqual({ label: "display:kiosk", capabilities: [DISPLAY_ANSWER_CAPABILITY] });
    expect(tokens.list().find((t) => t.label === "display:kiosk")?.capabilities).toEqual([DISPLAY_ANSWER_CAPABILITY]);
  });

  it("refuses the answer capability for anything but a display, and unknown capabilities", () => {
    const tokens = new TokenService(new HubDatabase(":memory:"));
    expect(() => tokens.issue("pixel", [DISPLAY_ANSWER_CAPABILITY])).toThrow(/only valid for display/);
    expect(() => tokens.issue("agent:mcp", [DISPLAY_ANSWER_CAPABILITY])).toThrow(/only valid for display/);
    expect(() => tokens.issue("display:nyx", ["approvals.everything"])).toThrow(/unknown token capability/);
    expect(tokens.list()).toHaveLength(0);
  });

  it("unreadable stored capabilities mean none — never more rights from broken data", () => {
    const db = new HubDatabase(":memory:");
    const tokens = new TokenService(db);
    const t = tokens.issue("display:nyx", [DISPLAY_ANSWER_CAPABILITY]).token;
    db.prepare("UPDATE device_tokens SET capabilities = ?").run("{kaputt");
    expect(tokens.identify(t)?.capabilities).toEqual([]);
  });
});

/** EPIC-P62 T62.2: Device-Tokens tragen das erkennbare Präfix `avt_` — ein
 * Leak ist in Text und Screenshot-OCR deterministisch findbar (check:media).
 * Gespeichert bleibt weiter nur der sha256; Alt-Tokens ohne Präfix gelten
 * unverändert (verify/identify hashen den Plaintext wie zuvor). */
describe("token prefix (EPIC-P62 T62.2)", () => {
  it("issue() vergibt das avt_-Präfix; verify/identify laufen über den vollen Plaintext", () => {
    const tokens = new TokenService(new HubDatabase(":memory:"));
    const { token, label } = tokens.issue("pixel");
    expect(token.startsWith("avt_")).toBe(true);
    expect(token.length).toBeGreaterThan(30);
    expect(tokens.verify(token)).toBe(true);
    expect(tokens.identify(token)?.label).toBe(label);
    // Präfix abgeschneiden = anderes Token: Der Hash kennt keine Normalize-Regel.
    expect(tokens.verify(token.slice(4))).toBe(false);
  });

  it("Alt-Token ohne Präfix bleibt gültig (Hash-Kompatibilität)", () => {
    const db = new HubDatabase(":memory:");
    const tokens = new TokenService(db);
    const legacy = "ohnepraefix-abc123";
    db.prepare("INSERT INTO device_tokens (token_hash, label, created_at) VALUES (?, ?, ?)").run(
      createHash("sha256").update(legacy).digest("hex"),
      "altgeraet",
      new Date().toISOString(),
    );
    expect(tokens.verify(legacy)).toBe(true);
    expect(tokens.identify(legacy)?.label).toBe("altgeraet");
  });
});
