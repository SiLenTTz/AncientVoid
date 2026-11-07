import { describe, expect, it } from "vitest";
import { classifyProviderError, providerErrorEvent } from "../../src/harness/provider-error.ts";

describe("classifyProviderError (ADR-0015)", () => {
  it("reads z.ai's usage-limit text with window and reset time", () => {
    const info = classifyProviderError("AI_APICallError: Usage limit reached for 5 hour. Your limit will reset at 2026-09-09 11:57:58");
    expect(info).toMatchObject({ category: "quota", window: "5 h", resetAt: "2026-09-09 11:57:58" });
    expect(info.title).toBe("Kontingent erschöpft (5 h)");
    expect(info.detail).toContain("wieder frei ab 2026-09-09 11:57:58");
  });

  it("names rate limits, auth, network and server errors", () => {
    expect(classifyProviderError("API Error: 429 Too Many Requests").category).toBe("rate_limit");
    expect(classifyProviderError("rate_limit_error: slow down").category).toBe("rate_limit");
    expect(classifyProviderError("Claude AI usage limit reached|1790200000").category).toBe("quota");
    expect(classifyProviderError("401 Unauthorized: invalid x-api-key").category).toBe("auth");
    expect(classifyProviderError("fetch failed: getaddrinfo ENOTFOUND api.z.ai").category).toBe("network");
    expect(classifyProviderError("API Error: 529 Overloaded").category).toBe("server");
  });

  it("is honest about an opaque server error", () => {
    const info = classifyProviderError("Unexpected server error. Check server logs for details.", "err_9508ce50");
    expect(info.category).toBe("server");
    expect(info.title).toBe("Serverfehler beim Provider");
    expect(info.detail).toContain("keine Ursache");
    expect(info.detail).toContain("err_9508ce50");
    expect(info.detail).toMatch(/Kontingent|Rate-Limit/);
  });

  it("keeps unknown text unknown and shows it", () => {
    const info = classifyProviderError("something odd");
    expect(info).toMatchObject({ category: "unknown", title: "Fehler beim Provider" });
    expect(info.detail).toContain("something odd");
  });

  it("builds one chat-visible system event", () => {
    const event = providerErrorEvent("opencode", "Usage limit reached for 5 hour. Your limit will reset at 2026-09-09 11:57:58");
    expect(event).toMatchObject({ type: "system", payload: { kind: "provider.error", category: "quota", provider: "opencode" } });
    expect(event.summary).toBe("opencode: Kontingent erschöpft (5 h)");
  });
});

describe("BUG-0102 maki-Verbindungsfehler", () => {
  it("klassifiziert „could not connect“ als Netzwerk", () => {
    expect(classifyProviderError("Internal error: could not connect, check the server is running and the base URL is correct").category).toBe("network");
  });
});
