import { describe, expect, it } from "vitest";
import { chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AdapterContext, EmittedEvent } from "@uacc/contracts";
import { makeRecordingContext, waitFor } from "@uacc/adapter-testkit";
import { ProcessRunner } from "@uacc/workers";
import { createAdapter } from "../src/index.ts";

const agent = fileURLToPath(new URL("../../../../e2e/support/bin/cursor-agent", import.meta.url));
chmodSync(agent, 0o755);

function context(turns?: string[]) {
  const runner = new ProcessRunner();
  return makeRecordingContext({
    spawnWorker: (cmd, o) => runner.spawn({ name: "cursor-test", cwd: process.cwd(), cmd, ...(o?.env ? { env: o.env } : {}) }),
    ...(turns ? { turn: (state: "working" | "idle") => turns.push(state) } : {}),
  } as Partial<AdapterContext>);
}

const kind = (events: EmittedEvent[], k: string) => events.find((e) => (e.payload as { kind?: string }).kind === k);
const texts = (events: EmittedEvent[]) => events.filter((e) => e.type === "assistant").map((e) => (e.payload as { text?: string }).text);

describe("cursor adapter", () => {
  it("ein Zug: stream-json wird gemappt, native chatId landet im Resume-Pfad", async () => {
    const turns: string[] = [];
    const ctx = context(turns);
    const adapter = createAdapter({ command: [agent].join(" "), mode: "ask" });
    // command ist ein String — der Adapter ruft spawnWorker(cmd) mit Array
    const handle = await adapter.start({ adapter: "cursor", project: process.cwd(), prompt: "Hallo" }, ctx);
    await waitFor(() => ctx.events.some((e) => (e.payload as { kind?: string }).kind === "cursor.result"));
    expect(texts(ctx.events)[0]).toContain("Antwort auf: Hallo · cursor");
    const meta = kind(ctx.events, "cursor.native_session");
    expect((meta?.payload as { nativeSessionId?: string }).nativeSessionId).toMatch(/^chat_/);
    expect(ctx.events.find((e) => (e.payload as { kind?: string }).kind === "cursor.result")?.tokensEst).toBe(1542);
    // Follow-up resumed die native chatId
    expect(await adapter.steer(handle, { kind: "prompt", text: "Nochmal" }, ctx)).toEqual({ ok: true });
    await waitFor(() => texts(ctx.events).length === 2);
    expect(texts(ctx.events)[1]).toContain("(fortgesetzt)");
    await adapter.stop(handle, ctx);
  });

  it("ein fehlschlagender Zug bleibt lesbar (ADR-0015) und der Prozess-Exit ist sichtbar", async () => {
    const ctx = context();
    await createAdapter({ command: [agent].join(" ") }).start({ adapter: "cursor", project: process.cwd(), prompt: "FEHLER" }, ctx);
    await waitFor(() => ctx.events.some((e) => (e.payload as { kind?: string }).kind === "cursor.result"));
    expect(kind(ctx.events, "cursor.result")?.payload).toMatchObject({ isError: true });
    await waitFor(() => ctx.events.some((e) => e.summary.includes("exited with code 1")));
  });

  it("models() listet den Katalog des CLIs auf (id - Label, live-Format)", async () => {
    const adapter = createAdapter({ command: [agent].join(" ") });
    const models = (await adapter.models?.()) ?? [];
    expect(models.map((m) => m.id)).toEqual(["auto", "claude-sonnet-5", "gpt-5.3-codex"]);
    expect(models[0]).toMatchObject({ label: "Auto (default)" });
  });
});
