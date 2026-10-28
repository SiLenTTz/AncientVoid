import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertContractGreen, makeRecordingContext, runLoopContractTests, waitFor } from "@uacc/adapter-testkit";
import { createLoopConnector } from "../src/index.ts";

const hasPython = spawnSync("python3", ["--version"], { stdio: "ignore" }).error === undefined;

/** Kleines Stand-in für scripts/betrieb.py: gibt aus status.json den Body aus und beendet sich mit dem Exit-Code darin. */
const FAKE_BETRIEB = `import json, os, sys
d = json.load(open(os.path.join(os.path.dirname(__file__), "status.json")))
print(json.dumps(d["body"]))
sys.exit(d["exit"])
`;

const healthy = { schema_version: "1", mode: "autonom", iteration: { id: "it-4", status: "running" }, heartbeat_age_seconds: 3, human_hold: { active: false, reason: null }, last_gates: { result: "passed", at: "2026-10-28T09:00:00Z" }, watchdog: { running: true, liveness_age_seconds: 2 } };

describe.skipIf(!hasPython)("securesight-Connector gegen ein Temp-Projekt (T19.5)", () => {
  let root: string;
  const setStatus = (exit: number, body: unknown = healthy) => writeFileSync(join(root, "scripts", "status.json"), JSON.stringify({ exit, body }));
  const tr = () => join(root, ".harness", "transcript", "s1.ndjson");
  const rec = (seq: number, extra: Record<string, unknown> = {}) => `${JSON.stringify({ schema_version: "2", at: "2026-10-28T09:00:00Z", seq, session: "s1", role: "llm", kind: "assistant_text", detail: `Zug ${seq}`, source: "claude", ...extra })}\n`;
  const of = (ctx: { events: { payload?: unknown }[] }, k: string) => ctx.events.filter((e) => (e.payload as { kind?: string }).kind === k).map((e) => e.payload as Record<string, unknown>);

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "uacc-harnez-"));
    for (const d of ["scripts", ".harness/notify", ".harness/transcript", ".harnez"]) mkdirSync(join(root, d), { recursive: true });
    writeFileSync(join(root, "scripts", "betrieb.py"), FAKE_BETRIEB);
    setStatus(0);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const connect = async (config: Record<string, unknown> = {}, spec: { orchestrator?: string; options?: Record<string, string> } = {}, resume: unknown = null) => {
    const connector = createLoopConnector({ pollMs: 40, ...config });
    const ctx = makeRecordingContext();
    const saved: unknown[] = [];
    const handle = await connector.start({ project: root, options: {}, ...spec }, ctx, { resume, saveCursor: (c) => saved.push(JSON.parse(JSON.stringify(c))) });
    return { connector, ctx, handle, saved };
  };

  it("besteht die Loop-Contract-Suite", async () => {
    const results = await runLoopContractTests(createLoopConnector, { config: { pollMs: 40 }, spec: { project: root, options: {} } });
    assertContractGreen(results);
  });

  it("meldet Betriebszustand, Prüfungen, Fortschritt und Eskalationen", async () => {
    writeFileSync(join(root, ".harnez", "progress.json"), JSON.stringify({ schema_version: "1", total: 8, done: 3, now: { story: "S-2", task: "T-5", phase: "bauen" } }));
    writeFileSync(join(root, ".harness", "notify", "20261028T090000-2.json"), JSON.stringify({ schema_version: "1", escalation_level: "2", reason_ref: "gates-rot", at: "2026-10-28T09:00:00Z", run_id: "r1" }));
    const { ctx, connector, handle } = await connect();
    expect(of(ctx, "loop.info")[0]).toMatchObject({ mode: "autonom", iteration: "it-4", iterationStatus: "running", watchdog: "läuft" });
    expect(of(ctx, "loop.progress")).toEqual(expect.arrayContaining([expect.objectContaining({ gate: { name: "gates", state: "passed", detail: "2026-10-28T09:00:00Z" } }), expect.objectContaining({ source: "harnez", done: 3, total: 8, phase: "bauen", feature: "S-2", step: "T-5" })]));
    expect(of(ctx, "loop.notify")[0]).toMatchObject({ level: "2", reason: "gates-rot", run: "r1" });
    expect(await connector.status(handle)).toEqual({ state: "healthy" });
    await connector.stop(handle, ctx);
  });

  it("das Transcript wird ab jetzt verfolgt, ohne die Vorgeschichte; eine halbe Zeile wartet", async () => {
    appendFileSync(tr(), rec(1) + rec(2));
    const { ctx, connector, handle, saved } = await connect();
    expect(of(ctx, "loop.transcript")).toHaveLength(0);
    appendFileSync(tr(), rec(3) + rec(4).slice(0, 30));
    await waitFor(() => of(ctx, "loop.transcript").length === 1, 3000);
    expect(of(ctx, "loop.transcript")[0]).toMatchObject({ seq: 3, role: "llm", kindOf: "assistant_text", detail: "Zug 3" });
    appendFileSync(tr(), rec(4).slice(30));
    await waitFor(() => of(ctx, "loop.transcript").length === 2, 3000);
    expect(of(ctx, "loop.transcript")[1]).toMatchObject({ seq: 4 });
    expect(saved.at(-1)).toMatchObject({ offsets: { "s1.ndjson": statSync(tr()).size } });
    await connector.stop(handle, ctx);
  });

  it("nach Wiederanlauf: keine Doppelmeldung, nachgetragene Zeilen kommen", async () => {
    writeFileSync(join(root, ".harness", "notify", "a-1.json"), JSON.stringify({ schema_version: "1", escalation_level: "1", reason_ref: "x", at: "t", run_id: "r" }));
    appendFileSync(tr(), rec(1));
    const first = await connect();
    await first.connector.stop(first.handle, first.ctx);
    appendFileSync(tr(), rec(2));
    const again = await connect({}, {}, first.saved.at(-1));
    await waitFor(() => of(again.ctx, "loop.transcript").length === 1, 3000);
    expect(of(again.ctx, "loop.transcript")[0]).toMatchObject({ seq: 2 });
    expect(of(again.ctx, "loop.notify")).toHaveLength(0);
    await again.connector.stop(again.handle, again.ctx);
  });

  it("Exit 3 (Mensch gefragt) → loop.hold, degraded; Exit 4 → Watchdog ausgefallen; Exit 5 → broken", async () => {
    setStatus(3, { ...healthy, human_hold: { active: true, reason: "Gates dreimal rot" } });
    const { ctx, connector, handle } = await connect();
    expect(of(ctx, "loop.hold")[0]).toMatchObject({ reason: "Gates dreimal rot" });
    expect(await connector.status(handle)).toMatchObject({ state: "degraded", detail: expect.stringContaining("Gates dreimal rot") });
    setStatus(4, { ...healthy, watchdog: { running: false } });
    await waitFor(() => of(ctx, "loop.broken").some((p) => p.reason === "Watchdog ausgefallen"), 3000);
    expect(await connector.status(handle)).toMatchObject({ state: "broken", detail: "Watchdog ausgefallen" });
    setStatus(5, {});
    await waitFor(() => of(ctx, "loop.broken").some((p) => String(p.reason).includes("Exit 5")), 3000);
    setStatus(0);
    await waitFor(() => of(ctx, "loop.recovered").some((p) => String(p.reason).includes("Exit 5")), 3000);
    expect(await connector.status(handle)).toEqual({ state: "healthy" });
    expect(of(ctx, "loop.recovered").some((p) => p.what === "hold")).toBe(true);
    await connector.stop(handle, ctx);
  });

  it("unbekanntes Schema oder kaputtes JSON wird laut gemeldet, nie still verworfen", async () => {
    setStatus(0, { ...healthy, schema_version: "9" });
    writeFileSync(join(root, ".harnez", "progress.json"), "{kaputt");
    writeFileSync(join(root, ".harness", "notify", "b-1.json"), JSON.stringify({ schema_version: "7" }));
    const { ctx, connector, handle } = await connect();
    const reasons = of(ctx, "loop.broken").map((p) => String(p.reason));
    expect(reasons.some((r) => r.includes("Supervisor-Schema 9"))).toBe(true);
    expect(reasons.some((r) => r.includes("progress.json"))).toBe(true);
    expect(reasons.some((r) => r.includes("b-1.json"))).toBe(true);
    await connector.stop(handle, ctx);
  });

  it("Orchestrator hermes liest den Zustand des Epics; fehlt er, wird das sichtbar", async () => {
    const hermesDir = join(root, "hermes");
    mkdirSync(hermesDir);
    writeFileSync(join(hermesDir, "epic-1-state.json"), JSON.stringify({ status: "running", tasks_total: 6, tasks_done: 2, current_task: "T3", gate_fails: 1 }));
    const ok = await connect({ hermesDir }, { orchestrator: "hermes", options: { epic: "epic-1" } });
    expect(of(ok.ctx, "loop.progress").find((p) => p.source === "hermes")).toMatchObject({ epic: "epic-1", done: 2, total: 6, status: "running", step: "T3", gateFails: 1 });
    await ok.connector.stop(ok.handle, ok.ctx);
    const missing = await connect({ hermesDir }, { orchestrator: "hermes", options: { epic: "epic-9" } });
    expect(of(missing.ctx, "loop.broken").some((p) => String(p.reason).includes("epic-9"))).toBe(true);
    await missing.connector.stop(missing.handle, missing.ctx);
    await expect(connect({ hermesDir }, { orchestrator: "hermes" })).rejects.toThrow(/epic/);
  });

  it("schreibt nichts ins Projekt und lehnt jeden Befehl ab", async () => {
    appendFileSync(tr(), rec(1));
    const snapshot = () => readdirSync(root, { recursive: true }).map((f) => `${f}:${statSync(join(root, String(f))).isFile() ? statSync(join(root, String(f))).mtimeMs : 0}`).sort();
    const before = snapshot();
    const { ctx, connector, handle } = await connect();
    await new Promise((r) => setTimeout(r, 200));
    expect(await connector.control(handle, { kind: "pause" }, ctx)).toMatchObject({ ok: false });
    await connector.stop(handle, ctx);
    expect(snapshot()).toEqual(before);
  });

  it("ein Verzeichnis ohne scripts/betrieb.py ist kein Projekt", async () => {
    rmSync(join(root, "scripts", "betrieb.py"));
    await expect(connect()).rejects.toThrow(/betrieb\.py/);
  });
});
