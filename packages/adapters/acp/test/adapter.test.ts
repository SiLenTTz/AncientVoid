import { describe, expect, it } from "vitest";
import { chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AdapterContext, EmittedEvent, ToolPermissionRequest } from "@uacc/contracts";
import { makeRecordingContext, waitFor } from "@uacc/adapter-testkit";
import { ProcessRunner } from "@uacc/workers";
import { ACP_PRESETS, createAdapter } from "../src/index.ts";
import { JsonRpcConnection as AcpConnection } from "@uacc/adapter-jsonrpc";
import { UpdateMapper } from "../src/normalize.ts";

const agent = fileURLToPath(new URL("../../../../e2e/support/bin/acp-agent", import.meta.url));
chmodSync(agent, 0o755);

/** A context with a real child process worker and the given hub answers. */
function context(opts: { answer?: "allow" | "deny"; asked?: ToolPermissionRequest[]; turns?: string[] } = {}) {
  const runner = new ProcessRunner();
  const ctx = makeRecordingContext({
    workdir: process.cwd(),
    spawnWorker: (cmd, o) => runner.spawn({ name: "acp-test", cwd: process.cwd(), cmd, ...(o?.env ? { env: o.env } : {}) }),
    ...(opts.answer
      ? {
          requestToolPermission: async (req: ToolPermissionRequest) => {
            opts.asked?.push(req);
            return opts.answer === "allow" ? { behavior: "allow" as const, updatedInput: req.input } : { behavior: "deny" as const, message: "nein" };
          },
        }
      : {}),
    turn: (state: "working" | "idle") => opts.turns?.push(state),
  } as Partial<AdapterContext>);
  return ctx;
}

const texts = (events: EmittedEvent[], type: string) => events.filter((e) => e.type === type).map((e) => (e.payload as { text?: string }).text);

describe("acp adapter (T7.2)", () => {
  it("presets: the opencode preset makes opencode ask (ADR-0018)", () => {
    expect(ACP_PRESETS.copilot.command).toEqual(["copilot", "--acp"]);
    expect(JSON.parse(ACP_PRESETS.opencode.env.OPENCODE_CONFIG_CONTENT).permission).toEqual({ edit: "ask", bash: "ask", webfetch: "ask" });
    expect(createAdapter({ preset: "dsh" }).capabilities().features).toMatchObject({ toolGate: "native", followUp: true, interrupt: true });
    expect(createAdapter({ command: ["x"], permissions: "reject" }).capabilities().features.toolGate).toBe("allowlist");
    expect(() => createAdapter({})).toThrow("preset");
  });

  it("a turn: whole messages (not token events), thinking, native id, turn signals, tokens", async () => {
    const turns: string[] = [];
    const ctx = context({ turns });
    const adapter = createAdapter({ command: [agent], label: "fake" });
    const handle = await adapter.start({ adapter: "acp", project: process.cwd(), prompt: "Hallo" }, ctx);
    await waitFor(() => turns.includes("idle"));
    expect(texts(ctx.events, "assistant")).toEqual(["Antwort auf: Hallo · ACP"]);
    expect(texts(ctx.events, "thinking")).toEqual(["Ich überlege kurz."]);
    const native = ctx.events.find((e) => (e.payload as { kind?: string }).kind === "acp.native_session");
    expect((native?.payload as { nativeSessionId?: string }).nativeSessionId).toMatch(/^acp_/);
    expect(ctx.events.find((e) => (e.payload as { kind?: string }).kind === "acp.turn_end")?.tokensEst).toBe(42);
    expect(turns).toEqual(["working", "idle"]);
    // follow-up in the same agent process
    expect(await adapter.steer(handle, { kind: "prompt", text: "Nochmal" }, ctx)).toEqual({ ok: true });
    await waitFor(() => texts(ctx.events, "assistant").length === 2);
    await adapter.stop(handle, ctx);
  });

  it("request_permission goes to the phone; allow picks allow_once — never allow_always", async () => {
    const asked: ToolPermissionRequest[] = [];
    const turns: string[] = [];
    const ctx = context({ answer: "allow", asked, turns });
    const adapter = createAdapter({ command: [agent] });
    await adapter.start({ adapter: "acp", project: process.cwd(), prompt: "Bitte WERKZEUG" }, ctx);
    await waitFor(() => turns.includes("idle"));
    expect(asked[0]).toMatchObject({ toolName: "Shell", input: { command: "echo hallo-acp" } });
    expect(asked[0]!.toolUseId).toMatch(/^call_/);
    expect(texts(ctx.events, "assistant")[0]).toContain("Ausgabe hallo-acp (allow-once)");
    const result = ctx.events.find((e) => e.type === "tool_result");
    expect(result?.payload).toMatchObject({ isError: false, content: "hallo-acp" });
  });

  it("deny, and no hub gate at all, both reject — the tool does not run", async () => {
    for (const ctx of [context({ answer: "deny" }), context()]) {
      const turns: string[] = [];
      (ctx as unknown as { turn: (s: string) => void }).turn = (s) => turns.push(s);
      const adapter = createAdapter({ command: [agent] });
      await adapter.start({ adapter: "acp", project: process.cwd(), prompt: "Bitte WERKZEUG" }, ctx);
      await waitFor(() => turns.includes("idle"));
      expect(texts(ctx.events, "assistant")[0]).toContain("nicht ausgeführt");
      expect(ctx.events.find((e) => e.type === "tool_result")?.payload).toMatchObject({ isError: true });
    }
  });

  it("park cancels the running turn; a second prompt while busy is refused with a reason", async () => {
    const turns: string[] = [];
    const ctx = context({ turns });
    const adapter = createAdapter({ command: [agent] });
    const handle = await adapter.start({ adapter: "acp", project: process.cwd(), prompt: "LANGSAM" }, ctx);
    await waitFor(() => turns.includes("working"));
    expect(await adapter.steer(handle, { kind: "prompt", text: "dazwischen" }, ctx)).toMatchObject({ ok: false, detail: expect.stringContaining("läuft noch") });
    await adapter.steer(handle, { kind: "park" }, ctx);
    await waitFor(() => turns.includes("idle"));
    expect(ctx.events.find((e) => (e.payload as { kind?: string }).kind === "acp.turn_end")?.payload).toMatchObject({ stopReason: "cancelled" });
    await adapter.stop(handle, ctx);
  });

  it("a failed prompt becomes a readable provider error (ADR-0015)", async () => {
    const turns: string[] = [];
    const ctx = context({ turns });
    await createAdapter({ command: [agent], label: "fake" }).start({ adapter: "acp", project: process.cwd(), prompt: "FEHLER" }, ctx);
    await waitFor(() => turns.includes("idle"));
    const error = ctx.events.find((e) => (e.payload as { kind?: string }).kind === "provider.error");
    expect(error?.payload).toMatchObject({ provider: "fake", category: "rate_limit" });
  });

  it("a plan shows up in the todo shape the run strip reads", async () => {
    const turns: string[] = [];
    const ctx = context({ turns });
    await createAdapter({ command: [agent] }).start({ adapter: "acp", project: process.cwd(), prompt: "PLAN" }, ctx);
    await waitFor(() => turns.includes("idle"));
    const plan = ctx.events.find((e) => (e.payload as { name?: string }).name === "todowrite");
    expect((plan?.payload as { input: { todos: unknown[] } }).input.todos).toHaveLength(3);
  });
});

describe("ACP JSON-RPC and update mapping", () => {
  it("answers the agent's requests, ignores log noise, reports stray results", async () => {
    const written: string[] = [];
    const stray: unknown[] = [];
    const noise: string[] = [];
    const conn = new AcpConnection((l) => written.push(l), {
      onNotification: () => undefined,
      onRequest: async (method) => ({ echoed: method }),
      onStrayResult: (r) => stray.push(r),
      onNoise: (l) => noise.push(l),
    });
    conn.feed('{"jsonrpc":"2.0","id":7,"method":"session/request_permission","params":{}}\r\nnpm warn something\n{"jsonrpc":"2.0","id":99,"result":{"stopReason":"end_turn"}}\n');
    await new Promise((r) => setTimeout(r, 0));
    expect(JSON.parse(written[0]!)).toEqual({ jsonrpc: "2.0", id: 7, result: { echoed: "session/request_permission" } });
    expect(noise).toEqual(["npm warn something"]);
    expect(stray).toEqual([{ stopReason: "end_turn" }]);
  });

  it("an unknown update kind is reported once, not dropped", () => {
    const mapper = new UpdateMapper("x");
    expect(mapper.map({ sessionUpdate: "hologram" })).toHaveLength(1);
    expect(mapper.map({ sessionUpdate: "hologram" })).toHaveLength(0);
  });
});

describe("acp attachments (T7.10)", () => {
  it("an image becomes an image block when the agent takes images", async () => {
    const turns: string[] = [];
    const ctx = context({ turns });
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "acp-att-"));
    writeFileSync(join(dir, "img"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await createAdapter({ command: [agent] }).start(
      { adapter: "acp", project: process.cwd(), prompt: "Schau", attachments: [{ id: "c".repeat(64), name: "bild.png", mimeType: "image/png", kind: "image", bytes: 4, path: join(dir, "img"), text: null, method: null }] },
      ctx,
    );
    await waitFor(() => turns.includes("idle"));
    expect(texts(ctx.events, "assistant")[0]).toContain("[image]");
    expect(texts(ctx.events, "assistant")[0]).toContain("(als Datei übergeben)");
  });
});
