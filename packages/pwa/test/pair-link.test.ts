import { describe, expect, it } from "vitest";
import { pairLink, parsePairLink } from "../src/pair-link.ts";

describe("invite QR payload (AI-P6-2)", () => {
  it("round-trips address and code", () => {
    const link = pairLink("https://silenttz-server.tail.ts.net/", "ABCD-EFGH-JKLM");
    expect(link).toBe("https://silenttz-server.tail.ts.net/#/pair?code=ABCD-EFGH-JKLM");
    expect(parsePairLink(link)).toEqual({ url: "https://silenttz-server.tail.ts.net", code: "ABCD-EFGH-JKLM" });
    expect(parsePairLink("http://100.64.0.2:7373/#/pair?code=ABCD-EFGH-JKLM")).toEqual({ url: "http://100.64.0.2:7373", code: "ABCD-EFGH-JKLM" });
  });

  it("rejects anything that is not an invite", () => {
    expect(parsePairLink("ABCD-EFGH-JKLM")).toBeNull();
    expect(parsePairLink("https://example.org/")).toBeNull();
    expect(parsePairLink("javascript:alert(1)//#/pair?code=X")).toBeNull();
    expect(parsePairLink("https://h/#/pair?code=A&x=1")).toBeNull();
  });
});
