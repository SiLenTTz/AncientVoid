import { describe, it, expect } from "vitest";
import { parseVoiceDirective } from "../src/voice-directives.ts";

describe("parseVoiceDirective (T3.10)", () => {
  it("recognizes a bare 'stopp'", () => {
    expect(parseVoiceDirective("stopp")).toEqual({ kind: "stop", summary: "Diese Session stoppen" });
  });

  it("recognizes 'stoppe die Session'", () => {
    expect(parseVoiceDirective("stoppe die Session")).toEqual({ kind: "stop", summary: "Diese Session stoppen" });
  });

  it("recognizes 'Session stoppen'", () => {
    expect(parseVoiceDirective("bitte Session stoppen jetzt")).toMatchObject({ kind: "stop" });
  });

  it("recognizes a German budget phrase with 'Dollar'", () => {
    expect(parseVoiceDirective("Budget auf 5 Dollar erhöhen")).toEqual({
      kind: "budget",
      amountUsd: 5,
      summary: "Budget auf 5.00$ ändern",
    });
  });

  it("parses a German decimal comma correctly", () => {
    const result = parseVoiceDirective("erhöhe das Budget auf 3,50 Euro");
    expect(result).toEqual({ kind: "budget", amountUsd: 3.5, summary: "Budget auf 3.50$ ändern" });
  });

  it("parses a budget phrase with no currency word", () => {
    expect(parseVoiceDirective("Budget auf 10 setzen")).toEqual({
      kind: "budget",
      amountUsd: 10,
      summary: "Budget auf 10.00$ ändern",
    });
  });

  it("returns unrecognized for an empty transcript", () => {
    expect(parseVoiceDirective("")).toEqual({ kind: "unrecognized" });
    expect(parseVoiceDirective("   ")).toEqual({ kind: "unrecognized" });
  });

  it("returns unrecognized for unrelated speech", () => {
    expect(parseVoiceDirective("zeig mir mobile-hub")).toEqual({ kind: "unrecognized" });
    expect(parseVoiceDirective("wie ist mein Kontingent")).toEqual({ kind: "unrecognized" });
  });

  it("does not false-positive on a word merely containing 'stopp' as a substring", () => {
    // "gestoppt" ends in "stopp" + "t" — must not match the bare-word pattern.
    expect(parseVoiceDirective("der Prozess wurde bereits gestoppt")).toEqual({ kind: "unrecognized" });
  });

  it("ignores a zero or negative budget amount as unrecognized rather than acting on it", () => {
    expect(parseVoiceDirective("Budget auf 0 Dollar setzen")).toEqual({ kind: "unrecognized" });
  });
});
