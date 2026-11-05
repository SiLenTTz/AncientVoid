import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("P27: sessions prints interrupted and future statuses; tail prints the interruption reason", async () => {
  const server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(req.url === "/api/sessions" ? [
      { id: "one", status: "interrupted", adapter: "dummy", lastSeq: 3, project: "/project" },
      { id: "two", status: "future_status", adapter: "dummy", lastSeq: 1, project: "/project" },
    ] : [{ seq: 3, ts: "2026-11-05T12:00:00Z", type: "system", summary: "session.interrupted: worker_exit", payload: { kind: "session.interrupted", reason: "worker_exit" } }]));
  });
  await new Promise<void>(resolveReady => server.listen(0, "127.0.0.1", resolveReady));
  try {
    const run = (args: string[]) => promisify(execFile)(process.execPath, [resolve("apps/hubctl/src/cli.ts"), ...args], {
      env: { ...process.env, ANCIENTVOID_URL: `http://127.0.0.1:${(server.address() as { port: number }).port}`, ANCIENTVOID_TOKEN: "" },
    });
    const sessions = await run(["sessions"]);
    expect(sessions.stdout).toContain("interrupted");
    expect(sessions.stdout).toContain("future_status");
    const tail = await run(["tail", "one"]);
    expect(tail.stdout).toContain("session.interrupted: worker_exit");
  } finally {
    await new Promise<void>((resolveClosed, reject) => server.close(err => err ? reject(err) : resolveClosed()));
  }
});
