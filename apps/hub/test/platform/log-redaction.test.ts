import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { AdapterRegistry, EventStore, HubDatabase, SessionManager, TokenService } from "@uacc/core";
import { ProcessRunner } from "@uacc/workers";
import { createHubApp, redactUrl } from "../../src/app.ts";

describe("no credentials in logs (BUG-0028, AC-P6-2)", () => {
  it("masks token query parameters", () => {
    expect(redactUrl("/api/events/abc/tail?token=s3cr3t")).toBe("/api/events/abc/tail?token=[redacted]");
    expect(redactUrl("/api/stt/stream?ticket=s3cr3t")).toBe("/api/stt/stream?ticket=[redacted]");
    expect(redactUrl("/x?a=1&token=s3cr3t&b=2")).toBe("/x?a=1&token=[redacted]&b=2");
    expect(redactUrl("/api/sessions")).toBe("/api/sessions");
  });

  it("the request log never contains a token from the URL", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uacc-redact-"));
    const lines: string[] = [];
    const logStream = new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    const sessions = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
    const tokens = new TokenService(db);
    const token = tokens.issue("phone").token;
    const app = await createHubApp({ sessions, tokens, registry, auth: { tokens, enforceTailnetIdentity: false }, logStream });
    try {
      await app.inject({ method: "GET", url: `/api/sessions?token=${token}` });
      await app.inject({ method: "GET", url: `/api/sessions`, headers: { authorization: `Bearer ${token}` } });
      const log = lines.join("");
      expect(log).toContain("/api/sessions?token=[redacted]");
      expect(log).not.toContain(token);
    } finally {
      await app.close();
      await sessions.shutdown();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
