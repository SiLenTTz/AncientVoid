import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { FastifyInstance } from "fastify";
import { EventStore, SessionManager, AdapterRegistry, HubDatabase, TokenService } from "@ancientvoid/core";
import { ProcessRunner } from "@ancientvoid/workers";
import { createAdapter as createDummy } from "@ancientvoid/adapter-dummy";
import { createHubApp } from "../src/app.ts";

// EPIC-P57 T57.5 / AC-P57-5: Die als `tutorial-step` markierten Befehle des
// Tutorials laufen gegen einen echten Hub; `# erwartet: <Text>` prüft die
// Ausgabe. Jeder bash-Block muss markiert sein (step oder manual), damit
// kein Befehl unbemerkt ungeprüft bleibt.

const exec = promisify(execFile);
const REPO = join(import.meta.dirname, "..", "..", "..");
const TUTORIAL = join(REPO, "docs/tutorial-erste-schritte.md");

interface Block { marker: string; body: string }

function parseBlocks(md: string): Block[] {
  return [...md.matchAll(/^```bash(?: (\S+))?\n([\s\S]*?)^```$/gm)].map((m) => ({ marker: m[1] ?? "", body: m[2]! }));
}

async function runSteps(md: string, env: Record<string, string>): Promise<number> {
  const blocks = parseBlocks(md);
  const unmarked = blocks.filter((b) => b.marker !== "tutorial-step" && b.marker !== "tutorial-manual");
  if (unmarked.length > 0) throw new Error(`bash-Block ohne Marker tutorial-step/tutorial-manual: ${unmarked[0]!.body.split("\n")[0]}`);
  let ran = 0;
  for (const block of blocks.filter((b) => b.marker === "tutorial-step")) {
    const lines = block.body.split("\n").filter((l) => l.trim() !== "");
    const expected = lines.filter((l) => l.startsWith("# erwartet:")).map((l) => l.replace("# erwartet:", "").trim());
    const cmds = lines.filter((l) => !l.startsWith("#"));
    let out = "";
    for (const cmd of cmds) {
      const r = await exec("bash", ["-c", cmd], { cwd: REPO, env: { ...process.env, ...env }, timeout: 30_000 }).catch((e: { stderr?: string; message: string }) => {
        throw new Error(`Tutorial-Schritt fehlgeschlagen: ${cmd} — ${e.stderr || e.message}`);
      });
      out += r.stdout;
      ran++;
    }
    for (const want of expected) if (!out.includes(want)) throw new Error(`Ausgabe enthält „${want}“ nicht:\n${out}`);
  }
  return ran;
}

describe("Tutorial erste Schritte — ausführbare Blöcke", () => {
  let dir: string;
  let app: FastifyInstance;
  let env: Record<string, string>;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-tutorial-"));
    const db = new HubDatabase(":memory:");
    const store = new EventStore(dir);
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, { eventsPerSecond: 5, autoStopAfterEvents: 0 });
    const sessions = new SessionManager(db, store, registry, new ProcessRunner());
    const tokens = new TokenService(db);
    const token = tokens.issue("tutorial").token;
    app = await createHubApp({ sessions, tokens, registry, auth: { tokens, enforceTailnetIdentity: false }, store });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const url = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
    env = { ANCIENTVOID_URL: url, ANCIENTVOID_TOKEN: token };
    // Schritt 3 des Tutorials (PWA „Neue Session“) vorwegnehmen: eine dummy-Session.
    const res = await app.inject({ method: "POST", url: "/api/sessions", headers: { authorization: `Bearer ${token}` }, payload: { adapter: "dummy", project: dir, prompt: "tutorial" } });
    expect(res.statusCode).toBeLessThan(300);
  });

  afterAll(async () => {
    await app.close().catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  });

  it("alle tutorial-step-Befehle laufen und liefern die erwartete Ausgabe", async () => {
    const md = await readFile(TUTORIAL, "utf8");
    expect(parseBlocks(md).some((b) => b.marker === "tutorial-step")).toBe(true);
    expect(await runSteps(md, env)).toBeGreaterThanOrEqual(3);
  });

  it("rot-dann-grün: falscher Befehl, falsche Erwartung und unmarkierter Block lassen den Test scheitern", async () => {
    await expect(runSteps("```bash tutorial-step\nnode apps/hubctl/src/cli.ts gibtsnicht\n```\n", env)).rejects.toThrow(/fehlgeschlagen/);
    await expect(runSteps("```bash tutorial-step\ncurl -sf \"$ANCIENTVOID_URL/api/ready\"\n# erwartet: NICHT-DA\n```\n", env)).rejects.toThrow(/enthält/);
    await expect(runSteps("```bash\nls\n```\n", env)).rejects.toThrow(/ohne Marker/);
  });
});
