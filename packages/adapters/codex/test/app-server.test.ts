import { describe, expect, it } from "vitest";
import { chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AdapterContext, EmittedEvent, ToolPermissionRequest } from "@uacc/contracts";
import { makeRecordingContext, waitFor } from "@uacc/adapter-testkit";
import { ProcessRunner } from "@uacc/workers";
import { createAdapter } from "../src/index.ts";
import { listModels } from "../src/app-server.ts";
import { quotaOf, itemCompleted } from "../src/app-server-events.ts";

const fakeCodex = fileURLToPath(new URL("../../../../e2e/support/bin/codex", import.meta.url));
chmodSync(fakeCodex, 0o755);

function context(answer?: (req: ToolPermissionRequest) => Promise<{ behavior: "allow"; updatedInput: Record<string, unknown> } | { behavior: "deny"; message: string }>) {
  const runner = new ProcessRunner();
  const turns: string[] = [];
  const asked: ToolPermissionRequest[] = [];
  const ctx = makeRecordingContext({
    workdir: process.cwd(),
    spawnWorker: (cmd, o) => runner.spawn({ name: "codex-test", cwd: process.cwd(), cmd, ...(o?.env ? { env: o.env } : {}) }),
    turn: (s: "working" | "idle") => turns.push(s),
    ...(answer
      ? {
          requestToolPermission: async (req: ToolPermissionRequest) => {
            asked.push(req);
            return answer(req);
          },
        }
      : {}),
  } as Partial<AdapterContext>);
  return { ctx, turns, asked };
}
const kinds = (events: EmittedEvent[]) => events.map((e) => (e.payload as { kind?: string }).kind);

describe("codex app-server mode (T7.2)", () => {
  it("capabilities: native gate, questions, quota, model choice — exec stays sandbox", () => {
    expect(createAdapter({ mode: "app-server" }).capabilities()).toMatchObject({ usage: true, features: { toolGate: "native", questions: true, modelChoice: "start" } });
    expect(createAdapter({ mode: "app-server", approvalPolicy: "never" }).capabilities().features.toolGate).toBe("sandbox");
    expect(createAdapter({ mode: "exec" }).capabilities().features.toolGate).toBe("sandbox");
    expect(createAdapter().capabilities().features.toolGate, "app-server is the default").toBe("native");
  });

  it("a turn: thread id, plan as todos, reasoning, answer, tokens, quota windows", async () => {
    const { ctx, turns } = context();
    await createAdapter({ mode: "app-server", command: fakeCodex }).start({ adapter: "codex", project: process.cwd(), prompt: "Hallo" }, ctx);
    await waitFor(() => turns.includes("idle"));
    expect(kinds(ctx.events)).toContain("codex.native_session");
    expect(ctx.events.find((e) => e.type === "assistant")?.payload).toMatchObject({ text: "Antwort auf: Hallo · Codex" });
    expect(ctx.events.find((e) => e.type === "thinking")?.payload).toMatchObject({ text: "Kurz überlegt." });
    expect(ctx.events.find((e) => (e.payload as { name?: string }).name === "todowrite")).toBeTruthy();
    expect(ctx.events.find((e) => (e.payload as { kind?: string }).kind === "codex.token_usage")?.tokensEst).toBe(120);
    const quota = ctx.events.find((e) => e.usageQuota)?.usageQuota;
    expect(quota?.windows.map((w) => [w.id, w.utilization])).toEqual([["five_hour", 0.12], ["seven_day", 0.4]]);
  });

  it("a command asks the phone; accept runs it, decline does not — never acceptForSession", async () => {
    for (const allow of [true, false]) {
      const { ctx, turns, asked } = context(async (req) => (allow ? { behavior: "allow", updatedInput: req.input } : { behavior: "deny", message: "nein" }));
      await createAdapter({ mode: "app-server", command: fakeCodex }).start({ adapter: "codex", project: process.cwd(), prompt: "Bitte WERKZEUG" }, ctx);
      await waitFor(() => turns.includes("idle"));
      expect(asked[0]).toMatchObject({ toolName: "Shell", input: { command: "echo hallo-codex" } });
      const answer = ctx.events.find((e) => e.type === "assistant")?.payload as { text: string };
      expect(answer.text).toContain(allow ? "Ausgabe hallo-codex (accept)" : "nicht ausgeführt (decline)");
      expect(ctx.events.find((e) => e.type === "tool_result")?.payload).toMatchObject({ isError: !allow });
    }
  });

  it("a codex question is answered on the phone and goes back by question id", async () => {
    const { ctx, turns, asked } = context(async (req) => ({ behavior: "allow", updatedInput: { ...req.input, answers: { "Welche Farbe?": "Grün" } } }));
    await createAdapter({ mode: "app-server", command: fakeCodex }).start({ adapter: "codex", project: process.cwd(), prompt: "FRAGE" }, ctx);
    await waitFor(() => turns.includes("idle"));
    expect(asked[0]).toMatchObject({ toolName: "AskUserQuestion", input: { questions: [{ question: "Welche Farbe?", options: [{ label: "Rot" }, { label: "Grün" }] }] } });
    expect((ctx.events.find((e) => e.type === "assistant")?.payload as { text: string }).text).toContain("Gewählt: Grün");
  });

  it("park interrupts the running turn", async () => {
    const { ctx, turns } = context();
    const adapter = createAdapter({ mode: "app-server", command: fakeCodex });
    const handle = await adapter.start({ adapter: "codex", project: process.cwd(), prompt: "LANGSAM" }, ctx);
    await adapter.steer(handle, { kind: "park" }, ctx);
    await waitFor(() => turns.includes("idle"));
    expect(ctx.events.find((e) => (e.payload as { kind?: string }).kind === "codex.turn_end")?.payload).toMatchObject({ status: "interrupted" });
    await adapter.stop(handle, ctx);
  });

  it("model catalog from model/list, hidden models left out", async () => {
    expect(await listModels(fakeCodex)).toEqual([
      { id: "gpt-6-astra", label: "GPT-6-Astra" },
      { id: "gpt-5.3-codex", label: "GPT-5.3-Codex" },
    ]);
  });
});

describe("codex app-server events", () => {
  it("quota needs a reset time — never a window that never expires", () => {
    expect(quotaOf({ primary: { usedPercent: 50, windowDurationMins: 300 } })).toBeUndefined();
  });
  it("a declined command is an error result that says so", () => {
    expect(itemCompleted({ type: "commandExecution", id: "i", status: "declined", exitCode: null })[0]?.payload).toMatchObject({ isError: true, content: "abgelehnt — nicht ausgeführt" });
  });
});
