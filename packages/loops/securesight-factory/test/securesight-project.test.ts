import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertContractGreen, makeRecordingContext, runLoopContractTests, waitFor } from "@uacc/adapter-testkit";
import type { SessionHandle } from "@uacc/contracts";
import { createLoopConnector } from "../src/index.ts";

const FIXTURES = fileURLToPath(new URL("./fixtures/project", import.meta.url));
const hasPython = spawnSync("python3", ["--version"], { stdio: "ignore" }).error === undefined;

/** Stand-in für die factory-CLI: gibt den Inhalt von progress-out.json als eine JSON-Zeile aus (Vertrag v1: stdout). */
const fakeFactoryBin = (root: string) => {
  const bin = join(root, "fake-factory.sh");
  writeFileSync(bin, `#!/bin/sh\ncat "${join(root, "progress-out.json")}"\n`, { mode: 0o755 });
  return bin;
};

describe("securesight-Connector im Modus project (T26.3, EPIC-P26)", () => {
  let root: string;
  let bin: string;
  const setProgress = (doc: unknown) => writeFileSync(join(root, "progress-out.json"), typeof doc === "string" ? doc : JSON.stringify(doc));
  const of = (ctx: { events: { payload?: unknown }[] }, k: string) => ctx.events.filter((e) => (e.payload as { kind?: string }).kind === k).map((e) => e.payload as Record<string, unknown>);

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "uacc-factory-project-"));
    cpSync(FIXTURES, root, { recursive: true });
    bin = fakeFactoryBin(root);
    setProgress({ schema_version: "1", total: 0, done: 0, stories: [], now: null, updated_at: null, events: [] });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const connect = async (config: Record<string, unknown> = {}, resume: unknown = null) => {
    const connector = createLoopConnector({ pollMs: 40, factory: bin, ...config });
    const ctx = makeRecordingContext();
    const saved: unknown[] = [];
    const handle = await connector.start({ project: root, options: {} }, ctx, { resume, saveCursor: (c) => saved.push(JSON.parse(JSON.stringify(c))) });
    return { connector, ctx, handle, saved };
  };

  /** status() ist asynchron — deshalb ein eigener Takt statt waitFor (das nur synchrone Prädikate nimmt). */
  const waitStatus = async (connector: { status: (h: SessionHandle) => Promise<{ state: string }> }, handle: SessionHandle, state: string) => {
    const t0 = Date.now();
    for (;;) {
      const health = await connector.status(handle);
      if (health.state === state) return;
      if (Date.now() - t0 > 3000) throw new Error(`waitStatus: timeout (${health.state} statt ${state})`);
      await new Promise((r) => setTimeout(r, 25));
    }
  };

  it("besteht die Loop-Contract-Suite auch im Projektmodus", async () => {
    const results = await runLoopContractTests(createLoopConnector, { config: { pollMs: 40, factory: bin }, spec: { project: root, options: {} } });
    assertContractGreen(results);
  });

  it("Fortschritt kommt aus `factory progress show` (Schema 1), Änderungen werden gemeldet", async () => {
    rmSync(join(root, ".factory", "lauf-status.json")); // Fixture hat einen alten Heartbeat; ohne Lauf ist healthy korrekt
    const { ctx, connector, handle } = await connect();
    await waitFor(() => of(ctx, "loop.info").length + of(ctx, "loop.progress").length > 0);
    setProgress({ schema_version: "1", total: 5, done: 2, now: { phase: "bauen", story: "S-1", task: "T-3" }, stories: [], updated_at: "2026-10-30T12:00:00Z", events: [] });
    await waitFor(() => of(ctx, "loop.progress").some((p) => p.source === "factory" && p.done === 2 && p.total === 5 && p.phase === "bauen"));
    expect(of(ctx, "loop.progress").at(-1)).toMatchObject({ feature: "S-1", step: "T-3" });
    await waitStatus(connector, handle, "healthy");
    await connector.stop(handle, ctx);
  });

  it("Lauf-Status (REQ-2903): Phase wird gemeldet, alter Heartbeat ⇒ „wartet ohne Fortschritt“ (degraded), frischer ⇒ wieder healthy", async () => {
    const { ctx, connector, handle } = await connect({ staleAfterS: 10 });
    const lauf = (doc: Record<string, unknown>) => writeFileSync(join(root, ".factory", "lauf-status.json"), JSON.stringify(doc));
    lauf({ schema_version: "1", task: "T1-Anmeldung", phase: "pre_task", heartbeat_at: Math.floor(Date.now() / 1000) - 600 });
    await waitFor(() => of(ctx, "loop.hold").some((p) => typeof p.reason === "string" && p.reason.includes("wartet ohne Fortschritt")));
    await waitStatus(connector, handle, "degraded");
    lauf({ schema_version: "1", task: "T1-Anmeldung", phase: "implementation", heartbeat_at: Math.floor(Date.now() / 1000) });
    await waitFor(() => of(ctx, "loop.info").some((p) => p.source === "lauf-status" && p.task === "T1-Anmeldung" && p.phase === "implementation"));
    await waitStatus(connector, handle, "healthy");
    await connector.stop(handle, ctx);
  });

  it("Fehlerbelege (Bootstrap/Lauf-Ende) werden einmal gemeldet — auch nach Wiederanlauf nicht doppelt (K7)", async () => {
    const { ctx, connector, handle, saved } = await connect();
    await waitFor(() => of(ctx, "loop.notify").length === 2);
    expect(of(ctx, "loop.notify")).toEqual(expect.arrayContaining([
      expect.objectContaining({ level: "factory", reason: expect.stringContaining("provider nicht konfiguriert") }),
      expect.objectContaining({ reason: expect.stringContaining("permission_denials") }),
    ]));
    const cursor = saved.at(-1);
    await connector.stop(handle, ctx);
    const second = await connect({}, cursor);
    await new Promise((r) => setTimeout(r, 150));
    expect(of(second.ctx, "loop.notify")).toHaveLength(0); // Cursor weiß: schon gemeldet
    await second.connector.stop(second.handle, second.ctx);
  });

  it("fail loud (K9): kaputtes JSON, unbekanntes Schema und fehlendes Binary ⇒ loop.broken mit Grund; Intake läuft weiter", async () => {
    setProgress("{kein json");
    const { ctx, connector, handle } = await connect();
    await waitFor(() => of(ctx, "loop.broken").length > 0);
    expect(of(ctx, "loop.broken")[0]).toMatchObject({ reason: expect.stringContaining("progress show") });
    await waitFor(() => of(ctx, "loop.info").some((p) => p.source === "intake" && p.status === "intake"));
    await connector.stop(handle, ctx);

    setProgress({ schema_version: "9", total: 1, done: 0, stories: [], now: null, updated_at: null, events: [] });
    const schemaCtx = makeRecordingContext();
    const schemaConnector = createLoopConnector({ pollMs: 40, factory: bin });
    const schemaHandle = await schemaConnector.start({ project: root, options: {} }, schemaCtx, { resume: null, saveCursor: () => {} });
    await waitFor(() => of(schemaCtx, "loop.broken").some((p) => typeof p.reason === "string" && p.reason.includes("Schema 9")));
    await schemaConnector.stop(schemaHandle, schemaCtx);

    const missingCtx = makeRecordingContext();
    const missingConnector = createLoopConnector({ pollMs: 40, factory: "/existiert/nicht/factory" });
    const missingHandle = await missingConnector.start({ project: root, options: {} }, missingCtx, { resume: null, saveCursor: () => {} });
    await waitFor(() => of(missingCtx, "loop.broken").length > 0);
    expect(await missingConnector.status(missingHandle)).toMatchObject({ state: "broken" });
    await missingConnector.stop(missingHandle, missingCtx);
  });

  it("Erkennung: Verzeichnis ohne betrieb.py und ohne .factory/config.json wird abgelehnt", async () => {
    const empty = mkdtempSync(join(tmpdir(), "uacc-factory-leer-"));
    try {
      const connector = createLoopConnector({ pollMs: 40 });
      await expect(connector.start({ project: empty, options: {} }, makeRecordingContext(), { resume: null, saveCursor: () => {} })).rejects.toThrow(/kein securesight-factory-Projekt/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it.skipIf(!hasPython)("Modus repo bleibt repo: betrieb.py gewinnt gegen .factory/config.json (Regressionsschutz)", async () => {
    mkdirSync(join(root, "scripts"), { recursive: true });
    writeFileSync(join(root, "scripts", "betrieb.py"), "# kein gültiges Python: supervisor fällt aus; entscheidend ist, dass der repo-Pfad benutzt wird\n");
    const { connector, ctx, handle } = await connect();
    await waitFor(() => ctx.events.some((e) => (e.payload as { kind?: string }).kind === "loop.broken"));
    expect(of(ctx, "loop.progress").every((p) => p.source !== "factory")).toBe(true);
    await connector.stop(handle, ctx);
  });

  it("schreibt nichts in das Projekt (Verzeichnis vorher = nachher, P19-Muster)", async () => {
    const before = readdirSync(root).sort().join(",");
    const { connector, ctx, handle } = await connect();
    await new Promise((r) => setTimeout(r, 200));
    expect(readdirSync(root).sort().join(",")).toBe(before);
    await connector.stop(handle, ctx);
  });
});
