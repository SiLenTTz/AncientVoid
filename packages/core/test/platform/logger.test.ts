import { describe, expect, it } from "vitest";
import { REDACT_LOG_KEYS } from "@ancientvoid/contracts";
import { createJsonLogger, redactFields } from "../../src/platform/logger.ts";

describe("redactFields (T4.5-3 / AC-P4.5-3)", () => {
  it("replaces authorization with [redacted] and never leaks the token", () => {
    const out = redactFields({ authorization: "Bearer secret-token" });
    expect(out).toEqual({ authorization: "[redacted]" });
    expect(JSON.stringify(out)).not.toContain("secret-token");
  });

  it("redacts every shared key, including nested objects", () => {
    const out = redactFields({
      token: "plain-token",
      cookie: "sid=abc",
      password: "hunter2",
      secret: "s",
      apiKey: "k",
      api_key: "k2",
      nested: { authorization: "Bearer nested-secret" },
      safe: "visible",
    }) as Record<string, unknown>;
    expect(out.token).toBe("[redacted]");
    expect(out.cookie).toBe("[redacted]");
    expect(out.password).toBe("[redacted]");
    expect(out.secret).toBe("[redacted]");
    expect(out.apiKey).toBe("[redacted]");
    expect(out.api_key).toBe("[redacted]");
    expect(out.safe).toBe("visible");
    expect((out.nested as { authorization: string }).authorization).toBe("[redacted]");
    const raw = JSON.stringify(out);
    expect(raw).not.toContain("plain-token");
    expect(raw).not.toContain("nested-secret");
    expect(raw).not.toContain("hunter2");
  });

  it("shares the exact key list Fastify pino redact uses (ADR-0010)", () => {
    expect([...REDACT_LOG_KEYS]).toEqual([
      "authorization",
      "token",
      "cookie",
      "password",
      "secret",
      "apiKey",
      "api_key",
    ]);
  });
});

describe("createJsonLogger", () => {
  it("writes one JSON line with redacted fields and child bindings", () => {
    const lines: string[] = [];
    const logger = createJsonLogger({
      write: (line) => lines.push(line),
      fields: { service: "test" },
    }).child({ sessionId: "s1" });
    logger.error("boom", { authorization: "Bearer secret-token", adapter: "dummy" });
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(parsed.level).toBe("error");
    expect(parsed.msg).toBe("boom");
    expect(parsed.service).toBe("test");
    expect(parsed.sessionId).toBe("s1");
    expect(parsed.adapter).toBe("dummy");
    expect(parsed.authorization).toBe("[redacted]");
    expect(lines[0]).not.toContain("secret-token");
  });
});
