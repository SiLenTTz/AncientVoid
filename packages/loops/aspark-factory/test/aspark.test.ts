import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import mqtt, { type MqttClient } from "mqtt";
import type { LoopConnector, ToolPermissionRequest } from "@uacc/contracts";
import { assertContractGreen, makeRecordingContext, runLoopContractTests, waitFor } from "@uacc/adapter-testkit";
import { createLoopConnector } from "../src/index.ts";

const hasMosquitto = spawnSync("mosquitto", ["-h"], { stdio: "ignore" }).error === undefined;

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = createServer().listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

const info = { v: 1, line: "alpha", type: "project", repo: "o/r", mode: "supervised", status: "online", activity: "idle", commands: ["pause", "resume", "set-mode", "work"], ts: "2026-10-28T10:00:00Z" };

describe.skipIf(!hasMosquitto)("aSPARK-Connector gegen einen echten Mosquitto (T19.4)", () => {
  let broker: ChildProcess;
  let url: string;
  let pub: MqttClient;
  const received: { topic: string; body: Record<string, unknown> }[] = [];

  const publish = (topic: string, body: unknown, retain = true) => pub.publishAsync(topic, typeof body === "string" ? body : JSON.stringify(body), { qos: 1, retain });

  beforeAll(async () => {
    const port = await freePort();
    const conf = join(mkdtempSync(join(tmpdir(), "uacc-mosq-")), "m.conf");
    writeFileSync(conf, `listener ${port} 127.0.0.1\nallow_anonymous true\n`);
    broker = spawn("mosquitto", ["-c", conf], { stdio: "ignore" });
    url = `mqtt://127.0.0.1:${port}`;
    for (let i = 0; i < 50; i++) {
      try {
        pub = await mqtt.connectAsync(url, { connectTimeout: 500, reconnectPeriod: 0 });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    await pub.subscribeAsync(["agent/+/command", "agent/+/+/answer"]);
    pub.on("message", (topic, payload) => received.push({ topic, body: JSON.parse(payload.toString()) }));
  });
  afterAll(async () => {
    await pub?.endAsync(true);
    broker?.kill();
  });

  const start = async (connector: LoopConnector, line = "alpha", answers?: (req: ToolPermissionRequest) => unknown) => {
    const ctx = makeRecordingContext({
      sessionId: `s-${line}-${Math.random().toString(36).slice(2, 7)}`,
      ...(answers ? { requestToolPermission: async (req: ToolPermissionRequest) => answers(req) as never } : {}),
    });
    const saved: unknown[] = [];
    const handle = await connector.start({ project: "/tmp", options: { line } }, ctx, { resume: null, saveCursor: (c) => saved.push(c) });
    return { ctx, handle, saved };
  };
  const kinds = (ctx: { events: { payload?: unknown }[] }) => ctx.events.map((e) => (e.payload as { kind?: string }).kind);

  it("besteht die Loop-Contract-Suite", async () => {
    await publish("agent/alpha/info", info);
    const results = await runLoopContractTests(createLoopConnector, { config: { url }, spec: { options: { line: "alpha" } } });
    assertContractGreen(results);
  });

  it("übersetzt Info, Zustand, Fortschritt (mit Gate), Statistik und Bericht", async () => {
    await publish("agent/beta/info", { ...info, line: "beta", mode: "dark" });
    await publish("agent/beta/s1/state", { v: 1, line: "beta", session: "s1", state: "working", ts: "2026-10-28T10:01:00Z" });
    await publish("agent/beta/s1/progress", { v: 1, line: "beta", session: "s1", feature: "f1", phase: "Act", step: "increment", tasksDone: 2, tasksTotal: 5, issue: 7, title: "Login", gate: { name: "ci", state: "running" } });
    await publish("agent/beta/stats", { v: 1, line: "beta", featuresCompleted: 3, featuresInProgress: 1, features: [{ feature: "f1", phase: "Act", step: "increment", tasksDone: 2, tasksTotal: 5 }], ts: "x" });
    await publish("agent/beta/report", { v: 1, line: "beta", text: "x".repeat(5000), counts: { merged: 2 }, url: null, ts: "2026-10-28T20:00:00Z" });
    const { ctx } = await start(createLoopConnector({ url }), "beta");
    await waitFor(() => kinds(ctx).includes("loop.report"), 5000);
    const by = (k: string) => ctx.events.find((e) => (e.payload as { kind: string }).kind === k)?.payload as Record<string, unknown>;
    expect(by("loop.info")).toMatchObject({ line: "beta", mode: "dark", activity: "idle" });
    expect(by("loop.state")).toMatchObject({ session: "s1", state: "working" });
    expect(by("loop.progress")).toMatchObject({ done: 2, total: 5, phase: "Act", issue: 7, gate: { name: "ci", state: "running" } });
    expect(by("loop.stats")).toMatchObject({ completed: 3, inProgress: 1 });
    const report = by("loop.report");
    expect(report.blob).toMatch(/^[0-9a-f]{64}$/); // K5: großer Bericht nur als Verweis
    expect(report.text).toBeUndefined();
    expect(ctx.blobs).toHaveLength(1);
  });

  it("meldet jede Nachricht nur einmal, auch wenn der Broker sie erneut liefert", async () => {
    const connector = createLoopConnector({ url });
    await publish("agent/gamma/info", { ...info, line: "gamma" });
    const { ctx } = await start(connector, "gamma");
    await waitFor(() => kinds(ctx).includes("loop.info"));
    await publish("agent/gamma/info", { ...info, line: "gamma", ts: "2026-10-28T10:05:00Z" });
    await new Promise((r) => setTimeout(r, 300));
    expect(kinds(ctx).filter((k) => k === "loop.info")).toHaveLength(1);
  });

  it("Rückfrage (permission): Hub erlaubt → die Linie bekommt allow mit der Frage-Id", async () => {
    const asked: ToolPermissionRequest[] = [];
    await publish("agent/delta/info", { ...info, line: "delta" });
    const { ctx, saved } = await start(createLoopConnector({ url }), "delta", (req) => {
      asked.push(req);
      return { behavior: "allow", updatedInput: {} };
    });
    await publish("agent/delta/s9/ask", { v: 1, id: "q-1", line: "delta", session: "s9", kind: "permission", toolName: "Bash", input: { command: "git merge" }, title: "Merge?", createdAt: "2026-10-28T10:00:00Z", expiresAt: "2099-01-01T00:00:00Z", timeoutAction: "deny" });
    await waitFor(() => received.some((r) => r.topic === "agent/delta/s9/answer"), 5000);
    expect(asked[0]).toMatchObject({ toolName: "Bash", toolUseId: "q-1", input: { command: "git merge" } });
    expect(received.find((r) => r.topic === "agent/delta/s9/answer")?.body).toEqual({ id: "q-1", decision: "allow" });
    expect(saved.at(-1)).toEqual({ answered: ["q-1"] });
    expect(kinds(ctx)).toContain("loop.ask");
  });

  it("Rückfrage (permission): Ablehnen geht als deny mit Grund zurück; dieselbe Frage nur einmal", async () => {
    let calls = 0;
    await publish("agent/eps/info", { ...info, line: "eps" });
    await start(createLoopConnector({ url }), "eps", () => {
      calls += 1;
      return { behavior: "deny", message: "nein" };
    });
    const ask = { v: 1, id: "q-2", line: "eps", session: "s1", kind: "permission", toolName: "Bash", input: {}, title: "x", createdAt: "2026-10-28T10:00:00Z", expiresAt: "2099-01-01T00:00:00Z", timeoutAction: "deny" };
    await publish("agent/eps/s1/ask", ask);
    await waitFor(() => received.some((r) => r.topic === "agent/eps/s1/answer"));
    await publish("agent/eps/s1/ask", ask);
    await new Promise((r) => setTimeout(r, 300));
    expect(received.filter((r) => r.topic === "agent/eps/s1/answer").map((r) => r.body)).toEqual([{ id: "q-2", decision: "deny", message: "nein" }]);
    expect(calls).toBe(1);
  });

  it("Rückfrage (question): Labels werden zu Indizes, freier Text zur Notiz", async () => {
    await publish("agent/zeta/info", { ...info, line: "zeta" });
    await start(createLoopConnector({ url }), "zeta", () => ({ behavior: "allow", updatedInput: { answers: { "Welche?": "B, C", "Warum?": "weil" } } }));
    await publish("agent/zeta/s1/ask", {
      v: 1, id: "q-3", line: "zeta", session: "s1", kind: "question", createdAt: "x", expiresAt: "2099-01-01T00:00:00Z", timeoutAction: "park",
      questions: [
        { header: "H", question: "Welche?", multiSelect: true, options: [{ label: "A" }, { label: "B" }, { label: "C" }] },
        { header: "W", question: "Warum?", multiSelect: false, options: [{ label: "x" }] },
      ],
    });
    await waitFor(() => received.some((r) => r.topic === "agent/zeta/s1/answer"));
    expect(received.find((r) => r.topic === "agent/zeta/s1/answer")?.body).toEqual({ id: "q-3", choices: [[1, 2], []], notes: ["", "weil"] });
  });

  it("nach Wiederanlauf wird eine schon beantwortete Frage nicht noch einmal gestellt", async () => {
    await publish("agent/eta/info", { ...info, line: "eta" });
    await publish("agent/eta/s1/ask", { v: 1, id: "q-old", line: "eta", session: "s1", kind: "permission", toolName: "Bash", input: {}, title: "x", createdAt: "x", expiresAt: "2099-01-01T00:00:00Z", timeoutAction: "deny" });
    let asked = 0;
    const ctx = makeRecordingContext({ requestToolPermission: async () => ((asked += 1), { behavior: "allow", updatedInput: {} }) });
    await createLoopConnector({ url }).start({ project: "/tmp", options: { line: "eta" } }, ctx, { resume: { answered: ["q-old"] }, saveCursor: () => undefined });
    await waitFor(() => kinds(ctx).includes("loop.info"));
    await new Promise((r) => setTimeout(r, 300));
    expect(asked).toBe(0);
  });

  it("Befehle gehen als Leitstand-Befehle an die Linie; Unbekanntes wird laut abgelehnt", async () => {
    await publish("agent/theta/info", { ...info, line: "theta" });
    const connector = createLoopConnector({ url });
    const { ctx, handle } = await start(connector, "theta");
    await waitFor(() => kinds(ctx).includes("loop.info"));
    expect(await connector.control(handle, { kind: "setMode", mode: "dark" }, ctx)).toEqual({ ok: true });
    expect(await connector.control(handle, { kind: "workNext", text: "#12" }, ctx)).toEqual({ ok: true });
    expect(await connector.control(handle, { kind: "pause" }, ctx)).toEqual({ ok: true });
    await waitFor(() => received.filter((r) => r.topic === "agent/theta/command").length === 3);
    expect(received.filter((r) => r.topic === "agent/theta/command").map((r) => r.body)).toEqual([{ command: "set-mode", mode: "dark" }, { command: "work", issue: 12 }, { command: "pause" }]);
    expect(await connector.control(handle, { kind: "setMode", mode: "wild" }, ctx)).toMatchObject({ ok: false });
    expect(await connector.control(handle, { kind: "workNext", text: "mach was" }, ctx)).toMatchObject({ ok: false });
  });

  it("ein Runner ohne den Befehl in commands[] wird als veraltet benannt", async () => {
    await publish("agent/iota/info", { ...info, line: "iota", commands: ["pause"] });
    const connector = createLoopConnector({ url });
    const { ctx, handle } = await start(connector, "iota");
    await waitFor(() => kinds(ctx).includes("loop.info"));
    const ack = await connector.control(handle, { kind: "resume" }, ctx);
    expect(ack).toMatchObject({ ok: false });
    expect(ack.detail).toContain("veraltet");
  });

  it("Last Will (offline), v≠1 und kaputtes JSON werden als loop.broken sichtbar", async () => {
    await publish("agent/kappa/info", { ...info, line: "kappa" });
    const connector = createLoopConnector({ url });
    const { ctx, handle } = await start(connector, "kappa");
    await waitFor(() => kinds(ctx).includes("loop.info"));
    await publish("agent/kappa/info", { ...info, line: "kappa", status: "offline" });
    await waitFor(() => kinds(ctx).includes("loop.broken"));
    expect(await connector.status(handle)).toMatchObject({ state: "down" });
    await publish("agent/kappa/s1/state", { v: 2, state: "working" });
    await waitFor(() => ctx.events.some((e) => String((e.payload as { reason?: string }).reason).includes("v=2")));
    expect(await connector.status(handle)).toMatchObject({ state: "broken" });
    await publish("agent/kappa/s1/progress", "{kaputt");
    await waitFor(() => ctx.events.some((e) => String((e.payload as { reason?: string }).reason).includes("kein gültiges JSON")));
  });

  it("start ohne gültige Linie scheitert laut, ein nicht erreichbarer Broker ebenso", async () => {
    const ctx = makeRecordingContext();
    const io = { resume: null, saveCursor: () => undefined };
    await expect(createLoopConnector({ url }).start({ project: "/tmp", options: { line: "Böse Linie" } }, ctx, io)).rejects.toThrow(/line/);
    const dead = await freePort();
    await expect(createLoopConnector({ url: `mqtt://127.0.0.1:${dead}` }).start({ project: "/tmp", options: { line: "alpha" } }, ctx, io)).rejects.toThrow();
  });
});
