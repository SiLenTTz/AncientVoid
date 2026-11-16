import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeLoopConnector, makeRecordingContext } from "@ancientvoid/adapter-testkit";
import { loopAsAdapter } from "../../../src/modules/loops/loop-adapter.ts";

const kinds = (events: { payload?: unknown }[]) => events.map((e) => (e.payload as { kind?: string })?.kind);

describe("loopAsAdapter (T19.2)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-loop-"));
  });
  afterEach(async () => {
    // maxRetries: Der Loop-Worker einer Recovery kann beim Aufräumen noch
    // Dateien schreiben — ohne Retry fiel rm sporadisch mit ENOTEMPTY
    // (CI-Lauf 3034470769, sonst nirgends reproduzierbar).
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  const spec = { adapter: "loop:fake-loop", project: "/tmp/x", prompt: "los", args: { loop: { project: "/tmp/x", mode: "ruhig", options: { line: "alpha" } } } };

  it("heißt loop:<id>, erklärt Betriebsarten zu Modi und gibt Fragen den Hub-Weg", () => {
    const adapter = loopAsAdapter(createFakeLoopConnector(), { stateDir: dir });
    expect(adapter.id).toBe("loop:fake-loop");
    expect(adapter.capabilities().features).toMatchObject({ followUp: true, interrupt: true, toolGate: "native", questions: true, permissionModes: ["ruhig", "scharf"], modelChoice: "none" });
  });

  it("start nimmt die Auswahl aus args.loop und sichert Startvorgabe + Leseposition (K7)", async () => {
    const adapter = loopAsAdapter(createFakeLoopConnector(), { stateDir: dir });
    const ctx = makeRecordingContext({ sessionId: "s1" });
    await adapter.start(spec, ctx);
    expect(kinds(ctx.events)).toContain("loop.info");
    await new Promise((r) => setTimeout(r, 50));
    const snap = JSON.parse(await readFile(join(dir, "s1.json"), "utf8"));
    expect(snap).toMatchObject({ spec: { project: "/tmp/x", goal: "los", mode: "ruhig", options: { line: "alpha" } }, cursor: { step: 1 } });
  });

  it("recover liest nach einem Hub-Neustart ab der gesicherten Position weiter", async () => {
    await loopAsAdapter(createFakeLoopConnector(), { stateDir: dir }).start(spec, makeRecordingContext({ sessionId: "s2" }));
    await new Promise((r) => setTimeout(r, 50));
    // frischer Adapter = frischer Prozess: nur der Snapshot auf der Platte bleibt
    const after = loopAsAdapter(createFakeLoopConnector(), { stateDir: dir });
    const ctx = makeRecordingContext({ sessionId: "s2" });
    const handle = await after.recover!("s2", 7, ctx);
    expect(handle?.sessionId).toBe("s2");
    expect(ctx.events.find((e) => (e.payload as { kind?: string }).kind === "loop.info")?.payload).toMatchObject({ resumed: true, line: "alpha" });
  });

  it("ohne Snapshot ist die Session nicht wiederherstellbar (null, nicht still)", async () => {
    const adapter = loopAsAdapter(createFakeLoopConnector(), { stateDir: dir });
    const ctx = makeRecordingContext({ sessionId: "weg" });
    expect(await adapter.recover!("weg", 0, ctx)).toBeNull();
    expect(ctx.logs.some((l) => l.level === "warn")).toBe(true);
  });

  it("park/resume/configure/prompt werden zu Loop-Befehlen, stop löscht den Snapshot", async () => {
    const adapter = loopAsAdapter(createFakeLoopConnector(), { stateDir: dir });
    const ctx = makeRecordingContext({ sessionId: "s3" });
    const handle = await adapter.start(spec, ctx);
    expect(await adapter.steer(handle, { kind: "park" }, ctx)).toEqual({ ok: true });
    expect(await adapter.steer(handle, { kind: "resume" }, ctx)).toEqual({ ok: true });
    expect(await adapter.steer(handle, { kind: "configure", permissionMode: "scharf" }, ctx)).toEqual({ ok: true });
    expect(await adapter.steer(handle, { kind: "configure", permissionMode: "dark" }, ctx)).toMatchObject({ ok: false, detail: expect.stringContaining("dark") });
    expect(await adapter.steer(handle, { kind: "configure", model: "x" }, ctx)).toMatchObject({ ok: false });
    expect(await adapter.steer(handle, { kind: "prompt", text: "nimm das nächste" }, ctx)).toEqual({ ok: true });
    const commands = ctx.events.filter((e) => (e.payload as { kind?: string }).kind === "loop.command").map((e) => (e.payload as { command: string }).command);
    expect(commands).toEqual(["pause", "resume", "setMode", "workNext"]);
    await adapter.stop(handle, ctx);
    await expect(readFile(join(dir, "s3.json"), "utf8")).rejects.toThrow();
  });
});
