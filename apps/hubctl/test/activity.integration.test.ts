import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const exec = promisify(execFile);
const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

describe("registered external jobs through the real hubctl process", () => {
  it.each([0, 7])("reports start and terminal state for exit code %s", async code => {
    const states: string[] = [];
    const server = createServer((req, reply) => {
      let body = "";
      req.on("data", chunk => { body += String(chunk); });
      req.on("end", () => {
        expect(req.url).toBe("/api/sessions/test-session/activity");
        expect(req.headers.authorization).toBe("Bearer test-token");
        states.push((JSON.parse(body) as { state: string }).state);
        reply.setHeader("content-type", "application/json");
        reply.end('{"ok":true}');
      });
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const result = await exec(process.execPath, [cli, "activity", "test-session", "gate", "run", "--", process.execPath, "-e", `if(process.env.ANCIENTVOID_TOKEN) process.exit(99); process.exit(${code})`], { env: { ...process.env, ANCIENTVOID_URL: `http://127.0.0.1:${port}`, ANCIENTVOID_TOKEN: "test-token" } }).then(() => 0, (err: { code: number }) => err.code);
      expect(result).toBe(code);
      expect(states).toEqual(["running", code === 0 ? "completed" : "failed"]);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });

  it("does not launch unregistered work when the hub refuses registration", async () => {
    const root = mkdtempSync(join(tmpdir(), "av-job-not-started-"));
    const marker = join(root, "ran");
    const server = createServer((_req, reply) => { reply.writeHead(422, { "content-type": "application/json" }); reply.end('{"error":"registration refused"}'); });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const port = (server.address() as { port: number }).port;
      await expect(exec(process.execPath, [cli, "activity", "test-session", "gate", "run", "--", process.execPath, "-e", `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran")`], { env: { ...process.env, ANCIENTVOID_URL: `http://127.0.0.1:${port}` } })).rejects.toThrow("registration refused");
      expect(existsSync(marker)).toBe(false);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }); }
  });
});
