import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import mqtt, { type MqttClient } from "mqtt";
import { LOOP_NEW } from "@ancientvoid/contracts";
import type { LoopConnector, ToolPermissionRequest } from "@ancientvoid/contracts";
import { assertContractGreen, makeRecordingContext, runLoopContractTests, waitFor } from "@ancientvoid/adapter-testkit";
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
    const conf = join(mkdtempSync(join(tmpdir(), "ancientvoid-mosq-")), "m.conf");
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
    await publish("agent/beta/old/state", { v: 1, line: "beta", session: "old", state: "done", ts: "2026-10-27T10:00:00Z" });
    await publish("agent/beta/s1/progress", { v: 1, line: "beta", session: "s1", feature: "f1", phase: "Act", step: "increment", tasksDone: 2, tasksTotal: 5, issue: 7, title: "Login", gate: { name: "ci", state: "running" } });
    await publish("agent/beta/stats", { v: 1, line: "beta", featuresCompleted: 3, featuresInProgress: 1, features: [{ feature: "f1", phase: "Act", step: "increment", tasksDone: 2, tasksTotal: 5 }], ts: "x" });
    await publish("agent/beta/report", { v: 1, line: "beta", text: "x".repeat(5000), counts: { merged: 2 }, url: null, ts: "2026-10-28T20:00:00Z" });
    const { ctx } = await start(createLoopConnector({ url }), "beta");
    await waitFor(() => kinds(ctx).includes("loop.report"), 5000);
    const by = (k: string) => ctx.events.find((e) => (e.payload as { kind: string }).kind === k)?.payload as Record<string, unknown>;
    expect(by("loop.info")).toMatchObject({ line: "beta", mode: "dark", activity: "idle" });
    expect(by("loop.state")).toMatchObject({ session: "s1", state: "working" });
    // Abgeschlossene Sessions aus dem retained Verlauf bleiben still.
    expect(ctx.events.filter((e) => (e.payload as { kind: string }).kind === "loop.state")).toHaveLength(1);
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
    let askedAt = 0;
    await publish("agent/delta/info", { ...info, line: "delta" });
    const { ctx, saved } = await start(createLoopConnector({ url }), "delta", (req) => {
      asked.push(req);
      askedAt = Date.now();
      return { behavior: "allow", updatedInput: {} };
    });
    const publishedAt = Date.now();
    await publish("agent/delta/s9/ask", { v: 1, id: "q-1", line: "delta", session: "s9", kind: "permission", toolName: "Bash", input: { command: "git merge" }, title: "Merge?", createdAt: "2026-10-28T10:00:00Z", expiresAt: "2099-01-01T00:00:00Z", timeoutAction: "deny" });
    await waitFor(() => received.some((r) => r.topic === "agent/delta/s9/answer"), 5000);
    // K1 (Maschinenanteil): Frage vom Broker bis zur Rückfrage im Hub und Antwort bis zum Broker, ohne den Menschen dazwischen.
    const answeredAt = Date.now();
    console.info(`K1 aSPARK: ask → Hub ${askedAt - publishedAt} ms, Entscheidung → Broker ${answeredAt - askedAt} ms`);
    expect(askedAt - publishedAt).toBeLessThan(1000);
    expect(answeredAt - askedAt).toBeLessThan(1000);
    expect(asked[0]).toMatchObject({ toolName: "Bash", toolUseId: "q-1", input: { command: "git merge" } });
    expect(received.find((r) => r.topic === "agent/delta/s9/answer")?.body).toEqual({ id: "q-1", decision: "allow" });
    expect(saved.at(-1)).toMatchObject({ answered: ["q-1"] });
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

  it("K7: nach dem Neustart kommt Gemeldetes nicht noch einmal (Info, Fortschritt, Störung)", async () => {
    await publish("agent/lambda/info", { ...info, line: "lambda" });
    await publish("agent/lambda/s1/state", { v: 1, line: "lambda", session: "s1", state: "working", ts: "x" });
    await publish("agent/lambda/s1/progress", { v: 1, line: "lambda", session: "s1", tasksDone: 1, tasksTotal: 3, phase: "Act" });
    const first = await start(createLoopConnector({ url }), "lambda");
    await waitFor(() => kinds(first.ctx).includes("loop.progress"));
    await publish("agent/lambda/s2/state", "{kaputt");
    await waitFor(() => kinds(first.ctx).includes("loop.broken"));
    const cursor = first.saved.at(-1);
    await createLoopConnector({ url }).stop(first.handle, first.ctx);
    const ctx = makeRecordingContext();
    const again = createLoopConnector({ url });
    const h = await again.start({ project: "/tmp", options: { line: "lambda" } }, ctx, { resume: cursor, saveCursor: () => undefined });
    await new Promise((r) => setTimeout(r, 400));
    expect(kinds(ctx)).toEqual([]);
    expect(await again.status(h)).toMatchObject({ state: "broken" });
    await again.stop(h, ctx);
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
    const offlineAt = Date.now();
    await publish("agent/kappa/info", { ...info, line: "kappa", status: "offline" });
    await waitFor(() => kinds(ctx).includes("loop.broken"));
    console.info(`K9 aSPARK: Last Will → loop.broken ${Date.now() - offlineAt} ms`);
    expect(Date.now() - offlineAt).toBeLessThan(5000);
    expect(await connector.status(handle)).toMatchObject({ state: "down" });
    await publish("agent/kappa/s1/state", { v: 2, state: "working" });
    await waitFor(() => ctx.events.some((e) => String((e.payload as { reason?: string }).reason).includes("v=2")));
    expect(await connector.status(handle)).toMatchObject({ state: "broken" });
    await publish("agent/kappa/s1/progress", "{kaputt");
    await waitFor(() => ctx.events.some((e) => String((e.payload as { reason?: string }).reason).includes("kein gültiges JSON")));
    // Wieder online: die Warnung wird zurückgenommen, vorher nicht (eine fremde Nachricht heilt kein Offline).
    expect(kinds(ctx)).not.toContain("loop.recovered");
    // Jede Störung löst sich erst durch eine saubere Nachricht ihrer eigenen Quelle.
    await publish("agent/kappa/info", { ...info, line: "kappa", ts: "2026-10-28T11:00:00Z" });
    await waitFor(() => kinds(ctx).filter((k) => k === "loop.recovered").length === 1);
    expect(await connector.status(handle)).toMatchObject({ state: "broken" });
    await publish("agent/kappa/s1/state", { v: 1, line: "kappa", session: "s1", state: "working", ts: "x" });
    await publish("agent/kappa/s1/progress", { v: 1, line: "kappa", session: "s1", tasksDone: 1, tasksTotal: 2 });
    await waitFor(() => kinds(ctx).filter((k) => k === "loop.recovered").length === 3);
    expect(await connector.status(handle)).toEqual({ state: "healthy" });
  });

  it("start ohne gültige Linie scheitert laut, ein nicht erreichbarer Broker ebenso", async () => {
    const ctx = makeRecordingContext();
    const io = { resume: null, saveCursor: () => undefined };
    await expect(createLoopConnector({ url }).start({ project: "/tmp", options: { line: "Böse Linie" } }, ctx, io)).rejects.toThrow(/line/);
    const dead = await freePort();
    await expect(createLoopConnector({ url: `mqtt://127.0.0.1:${dead}` }).start({ project: "/tmp", options: { line: "alpha" } }, ctx, io)).rejects.toThrow();
  });
});

describe("Repo anbinden über factoryctl (Onboarding)", () => {
  const ctl = fileURLToPath(new URL("./support/factoryctl", import.meta.url));
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "ancientvoid-factory-"));
    writeFileSync(join(home, "factory.env"), "MQTT_LEITSTAND_PASSWORD=pw\n");
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));
  const connector = () => createLoopConnector({ factoryctl: ctl, factoryHome: home });
  const run = (options: Record<string, string>, secret: string) => connector().onboard!({ options, secret }, AbortSignal.timeout(20_000));

  it("ohne factoryctl in der Config gibt es kein Onboarding und die Linie ist ein Textfeld", () => {
    const caps = createLoopConnector({}).capabilities();
    expect(caps.onboarding).toBeUndefined();
    expect(caps.options[0]).toMatchObject({ key: "line", kind: "text" });
  });

  it("mit factoryctl: bestehende Linien stehen zur Auswahl, dazu „Neues Repo anbinden“", () => {
    mkdirSync(join(home, "lines", "web"), { recursive: true });
    writeFileSync(join(home, "lines", "web", "line.env"), "LINE_REPO=o/web\nLINE_MODE=dark\nGITHUB_TOKEN=geheim-nicht-anzeigen\n");
    const caps = connector().capabilities();
    expect(caps.options[0]?.choices).toEqual([{ value: "web", label: "web — o/web (dark)" }, { value: LOOP_NEW, label: "Neues Repo anbinden …" }]);
    expect(JSON.stringify(caps)).not.toContain("geheim-nicht-anzeigen");
    expect(caps.onboarding?.optionKey).toBe("line");
  });

  it("ein neues Repo wird eingerichtet, das Token geht nur über stdin und taucht nirgends auf", async () => {
    const res = await run({ repo: "acme/Mein_Repo" }, "gut");
    expect(res).toMatchObject({ ok: true, options: { line: "mein-repo" } });
    expect(readFileSync(join(home, "lines", "mein-repo", "line.env"), "utf8")).toContain("LINE_REPO=acme/Mein_Repo");
    expect(JSON.stringify(res)).not.toContain("gut\"");
    expect(connector().capabilities().options[0]?.choices?.map((c) => c.value)).toContain("mein-repo");
    // dasselbe Repo noch einmal: nichts wird neu angelegt, die Linie wird einfach genommen
    expect(await run({ repo: "acme/Mein_Repo" }, "egal")).toMatchObject({ ok: true, options: { line: "mein-repo" } });
    expect(await run({ repo: "acme/anderes", name: "mein-repo" }, "gut")).toMatchObject({ ok: false, detail: expect.stringContaining("acme/Mein_Repo") });
  });

  it("ein abgelehntes Token meldet den Grund von factoryctl, ohne das Token zu zeigen, und legt nichts an", async () => {
    const res = await run({ repo: "acme/web", name: "web" }, "falsches-token");
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.detail).toContain("HTTP 401");
    expect(JSON.stringify(res)).not.toContain("falsches-token");
    expect(existsSync(join(home, "lines", "web"))).toBe(false);
  });

  it("falsche Angaben werden vor dem Aufruf abgelehnt; ohne Setup gibt es den Befehl dafür", async () => {
    for (const [options, expected] of [
      [{ repo: "kein-repo" }, "Repo"],
      [{ repo: "a/b", name: "Groß" }, "Name der Linie"],
      [{ repo: "a/b", name: "admin" }, "Name der Linie"],
      [{ repo: "a/b", mode: "dark" }, "Betriebsart"],
      [{ repo: "a/b", gitlabUrl: "ftp://x" }, "GitLab-Server"],
    ] as const) {
      expect(await run({ ...options }, "gut")).toMatchObject({ ok: false, detail: expect.stringContaining(expected) });
    }
    expect(await run({ repo: "a/b" }, "")).toMatchObject({ ok: false });
    rmSync(join(home, "factory.env"));
    expect(await run({ repo: "a/b" }, "gut")).toMatchObject({ ok: false, detail: expect.stringContaining("setup") });
  });

  it.skipIf(!hasMosquitto)("das Leitstand-Passwort kommt aus factory.env; ein Broker mit Anmeldung nimmt es an, ohne wird laut abgelehnt", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ancientvoid-mosq-auth-"));
    spawnSync("mosquitto_passwd", ["-b", "-c", join(dir, "pw"), "leitstand", "pw-aus-factory-env"]);
    const port = await freePort();
    writeFileSync(join(dir, "m.conf"), `listener ${port} 127.0.0.1\nallow_anonymous false\npassword_file ${join(dir, "pw")}\n`);
    const broker = spawn("mosquitto", ["-c", join(dir, "m.conf")], { stdio: "ignore" });
    try {
      await new Promise((r) => setTimeout(r, 500));
      writeFileSync(join(home, "factory.env"), "OTHER=1\nMQTT_LEITSTAND_PASSWORD=pw-aus-factory-env\n");
      const url = `mqtt://127.0.0.1:${port}`;
      const io = { resume: null, saveCursor: () => undefined };
      const ok = createLoopConnector({ url, username: "leitstand", passwordEnvFile: join(home, "factory.env") });
      const h = await ok.start({ project: "/tmp", options: { line: "web" } }, makeRecordingContext(), io);
      await ok.stop(h, makeRecordingContext());
      const noPw = createLoopConnector({ url, username: "leitstand" });
      await expect(noPw.start({ project: "/tmp", options: { line: "web" } }, makeRecordingContext(), io)).rejects.toThrow(/nicht erreichbar/);
    } finally {
      broker.kill();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
