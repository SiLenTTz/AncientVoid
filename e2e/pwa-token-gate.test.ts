import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import type { FastifyInstance } from "fastify";
import { EventStore, HubDatabase, SessionManager, AdapterRegistry, TokenService } from "@uacc/core";
import { ProcessRunner } from "@uacc/workers";
import { createAdapter as createDummy } from "@uacc/adapter-dummy";
import { createHubApp } from "../packages/server/src/index.ts";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "..");
const pwaDist = resolve(repoRoot, "packages/pwa/dist");

async function chromiumAvailable(): Promise<boolean> {
  try {
    const browser = await chromium.launch({ headless: true });
    await browser.close();
    return true;
  } catch {
    return false;
  }
}

const hasBrowser = await chromiumAvailable();
const itE2e = hasBrowser ? it : it.skip;

describe("PWA token gate (T4.5-5 / AC-P4.5-4)", () => {
  let dir: string | undefined;
  let app: FastifyInstance | undefined;
  let sessions: SessionManager | undefined;
  let token = "";
  let origin = "";
  let browser: Browser | undefined;
  let page: Page | undefined;

  beforeAll(async () => {
    if (!hasBrowser) return;
    if (!existsSync(join(pwaDist, "index.html"))) {
      await execFileAsync("npm", ["-w", "@uacc/pwa", "run", "build"], { cwd: repoRoot });
    }
    dir = await mkdtemp(join(tmpdir(), "uacc-e2e-"));
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, { eventsPerSecond: 10, autoStopAfterEvents: 5 });
    sessions = new SessionManager(db, store, registry, new ProcessRunner());
    const tokens = new TokenService(db);
    token = tokens.issue("e2e-device").token;
    app = await createHubApp({
      sessions,
      tokens,
      registry,
      auth: { tokens, enforceTailnetIdentity: false },
      pwaDir: pwaDist,
      store,
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as { port: number }).port;
    origin = `http://127.0.0.1:${port}`;
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
  }, 120_000);

  afterAll(async () => {
    await page?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    await sessions?.shutdown().catch(() => undefined);
    await app?.close().catch(() => undefined);
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  itE2e("shows TokenGate without a token", async () => {
    if (!page) throw new Error("page not started");
    await page.goto(origin);
    await page.getByRole("heading", { name: "UACC Hub" }).waitFor();
    expect(await page.getByLabel("Device-Token").count()).toBe(1);
  });

  itE2e("opens the dashboard after a valid token", async () => {
    if (!page) throw new Error("page not started");
    await page.goto(origin);
    await page.getByLabel("Device-Token").fill(token);
    await page.getByRole("button", { name: "Verbinden" }).click();
    await page.getByRole("heading", { name: "UACC", exact: true }).waitFor();
    expect(await page.getByRole("heading", { name: "UACC", exact: true }).count()).toBe(1);
  });
});
