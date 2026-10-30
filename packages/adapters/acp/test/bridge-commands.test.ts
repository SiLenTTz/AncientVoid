import { describe, it, expect, beforeAll } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { makeRecordingContext, waitFor } from "@uacc/adapter-testkit";
import { ProcessRunner } from "@uacc/workers";
import { createAdapter } from "../src/index.ts";

const agent = fileURLToPath(new URL("./bridge-agent", import.meta.url));
chmodSync(agent, 0o755);

/** BUG-0079: maki 0.6.5 führt die init.lua-Brücke im ACP-Modus nicht (Slot
 * agent.user_message feuert dort nie; run_command braucht ohnehin eine UI).
 * Deklarierte Commands (hier /new) muss der Adapter selbst ausführen — ohne
 * Modellturn, mit sichtbarem acp.command_executed — und der nächste Prompt
 * geht an die frische ACP-Session. */
describe("acp bridge commands (BUG-0079)", () => {
  let dir: string;
  let log: string;
  let runner: ProcessRunner;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "uacc-bridge-"));
    log = join(dir, "rpc.log");
    writeFileSync(log, "");
    runner = new ProcessRunner();
  });

  async function setup() {
    writeFileSync(log, "");
    const adapter = createAdapter({ command: [process.execPath, agent], bridgeCommands: true, label: "BridgeTest" });
    const ctx = makeRecordingContext({
      spawnWorker: (cmd, o) =>
        runner.spawn({ name: "bridge-agent", cwd: process.cwd(), cmd, env: { ...process.env, ...(o?.env ?? {}), UACC_BRIDGE_LOG: log } }),
    });
    const handle = await adapter.start({ adapter: adapter.id, project: process.cwd(), prompt: "start" }, ctx);
    await waitFor(() => readFileSync(log, "utf8").includes("session/prompt"), 5000);
    return { adapter, ctx, handle: handle! };
  }

  const lines = () =>
    readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { m: string; p: Record<string, unknown> | null });
  const methods = () => lines().map((l) => l.m);

  it("führt /new als neue ACP-Session aus — ohne Modellturn, sichtbar als Event", async () => {
    const { adapter, ctx, handle } = await setup();
    const promptCountBefore = methods().filter((m) => m === "session/prompt").length;
    const newCountBefore = methods().filter((m) => m === "session/new").length;

    const ack = await adapter.steer(handle, { kind: "prompt", text: "/new" }, ctx);
    expect(ack.ok).toBe(true);

    await waitFor(() => ctx.events.some((e) => e.payload?.kind === "acp.command_executed"), 5000);
    await waitFor(() => methods().filter((m) => m === "session/new").length > newCountBefore, 5000);

    // Kein Modellturn: session/prompt wurde für den Command nicht aufgerufen.
    expect(methods().filter((m) => m === "session/prompt").length).toBe(promptCountBefore);
    const ev = ctx.events.find((e) => e.payload?.kind === "acp.command_executed");
    expect(ev?.payload?.command).toBe("/new");

    // Der nächste Prompt geht an die FRISCHE Session — nicht an die alte Id.
    await adapter.steer(handle, { kind: "prompt", text: "hallo nach /new" }, ctx);
    await waitFor(() => methods().filter((m) => m === "session/prompt").length > promptCountBefore, 5000);
    expect(ctx.events.some((e) => e.type === "assistant" && String(e.summary ?? "").includes("/new"))).toBe(false);
  }, 20_000);

  it("BUG-0080: /new wählt das konfigurierte Modell auf der Frischsession", async () => {
    writeFileSync(log, "");
    const adapter = createAdapter({ command: [process.execPath, agent], bridgeCommands: true, model: "stub/good", label: "BridgeModel" });
    const ctx = makeRecordingContext({
      spawnWorker: (cmd, o) =>
        runner.spawn({ name: "bridge-agent-model", cwd: process.cwd(), cmd, env: { ...process.env, ...(o?.env ?? {}), UACC_BRIDGE_LOG: log } }),
    });
    const handle = await adapter.start({ adapter: adapter.id, project: process.cwd(), prompt: "start" }, ctx);
    await waitFor(() => methods().includes("session/prompt"), 5000);
    // Initial-Start setzt das konfigurierte Modell bereits (Start-Session).
    const firstSet = lines().find((l) => l.m === "session/set_config_option");
    expect(firstSet?.p?.value).toBe("stub/good");

    const ack = await adapter.steer(handle!, { kind: "prompt", text: "/new" }, ctx);
    expect(ack.ok).toBe(true);
    await waitFor(() => ctx.events.some((e) => e.payload?.kind === "acp.command_executed"), 5000);

    // Ohne Fix bleibt es bei EINEM Set (Start) — die Frischsession liefe auf
    // dem Default-Modell (live: zai/glm-5-code → ZHIPU 403, BUG-0080).
    const sets = lines().filter((l) => l.m === "session/set_config_option");
    expect(sets.length).toBeGreaterThanOrEqual(2);
    const fresh = sets.at(-1)!.p!;
    expect(fresh.value).toBe("stub/good");
    expect(fresh.sessionId).not.toBe(firstSet!.p!.sessionId);
  }, 20_000);

  it("undeklarierte Slashes bleiben Chat (kein Still-Fehlleiten)", async () => {
    const { adapter, ctx, handle } = await setup();
    const before = methods().filter((m) => m === "session/prompt").length;
    const ack = await adapter.steer(handle, { kind: "prompt", text: "/foobar jetzt" }, ctx);
    expect(ack.ok).toBe(true);
    await waitFor(() => methods().filter((m) => m === "session/prompt").length > before, 5000);
    expect(ctx.events.some((e) => e.payload?.kind === "acp.command_executed")).toBe(false);
  }, 20_000);

  it("ohne bridgeCommands-Flag geht /new als normaler Prompt durch", async () => {
    writeFileSync(log, "");
    const adapter = createAdapter({ command: [process.execPath, agent], label: "BridgeOff" });
    const ctx = makeRecordingContext({
      spawnWorker: (cmd, o) =>
        runner.spawn({ name: "bridge-agent-off", cwd: process.cwd(), cmd, env: { ...process.env, ...(o?.env ?? {}), UACC_BRIDGE_LOG: log } }),
    });
    const handle = await adapter.start({ adapter: adapter.id, project: process.cwd(), prompt: "start" }, ctx);
    await waitFor(() => readFileSync(log, "utf8").includes("session/prompt"), 5000);
    const before = methods().filter((m) => m === "session/prompt").length;
    await adapter.steer(handle!, { kind: "prompt", text: "/new" }, ctx);
    await waitFor(() => methods().filter((m) => m === "session/prompt").length > before, 5000);
    expect(ctx.events.some((e) => e.payload?.kind === "acp.command_executed")).toBe(false);
  }, 20_000);
});
