import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { AdapterRegistry, EventStore, HubDatabase, SessionManager, TokenService } from "@ancientvoid/core";
import { basicFeatures, type Adapter } from "@ancientvoid/contracts";
import { ProcessRunner } from "@ancientvoid/workers";
import { createHubApp } from "../../../src/app.ts";

/**
 * ADR-0085: Kai steuert Pi vom Handy. Pi nimmt Meldungen erst im nächsten Zug an
 * (`promptDelivery: "next-turn"`), kann aber lenken (`steer: true`). Beides soll wählbar
 * sein — und eine vorgemerkte Meldung soll nachträglich änderbar und umhängbar sein.
 */
describe("hub route — Wahl der Zustellung und nachträgliches Ändern (ADR-0085)", () => {
  let dir: string;
  let app: FastifyInstance;
  let token: string;
  const prompts: string[] = [];

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-queue-edit-"));
    const adapter: Adapter = {
      id: "piturny",
      version: "0.0.1",
      capabilities: () => ({
        promptDelivery: "next-turn",
        midTurnInput: true, // Pi-Form: jeder Lenk-Aufruf ist ein eigener Lauf
        reasoning: false,
        tools: false,
        cost: false,
        steer: true,
        usage: false,
        nativeDiscovery: "none",
        nativeResume: "none",
        features: basicFeatures({ followUp: true, interrupt: true }),
      }),
      async start(_spec, ctx) {
        return { sessionId: ctx.sessionId };
      },
      async steer(_h, input) {
        if (input.kind === "prompt") prompts.push(input.text);
        return { ok: true };
      },
      async status() {
        return { state: "healthy" };
      },
      async stop() {},
    };
    // ADR-0074 gegen Test: ein next-turn-Adapter OHNE midTurnInput (Claude-Form) darf das
    // sofortige Senden weiterhin ablehnen — die Zusicherung ist die einzige Ausnahme.
    const stubborn: Adapter = {
      ...adapter,
      id: "stubturny",
      capabilities: () => ({
        promptDelivery: "next-turn",
        reasoning: false,
        tools: false,
        cost: false,
        steer: true,
        usage: false,
        nativeDiscovery: "none",
        nativeResume: "none",
        features: basicFeatures({ followUp: true, interrupt: true }),
      }),
    };
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    registry.register("piturny", () => adapter);
    registry.register("stubturny", () => stubborn);
    const sessions = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
    const tokens = new TokenService(db);
    token = tokens.issue("test-device").token;
    app = await createHubApp({ sessions, tokens, registry, auth: { tokens, enforceTailnetIdentity: false } });
  });

  afterAll(async () => {
    await app.close().catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  });

  const call = (method: "POST" | "GET" | "DELETE" | "PATCH", url: string, payload?: Record<string, unknown>) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload !== undefined ? { payload } : {}) });
  const create = async (): Promise<string> => ((await call("POST", "/api/sessions", { adapter: "piturny", project: "/tmp" })).json() as { id: string }).id;
  const queue = async (id: string): Promise<{ id: string; text: string; position: number }[]> =>
    (await call("GET", `/api/sessions/${id}/queue`)).json() as { id: string; text: string; position: number }[];

  it("ein next-turn-Adapter merkt standardmäßig vor — nichts geht verloren", async () => {
    const id = await create();
    const ack = await call("POST", `/api/sessions/${id}/steer`, { kind: "prompt", text: "am Zugende", });
    expect(ack.statusCode).toBe(200);
    expect(ack.json()).toMatchObject({ ok: true, detail: "queued" });
    expect(prompts).not.toContain("am Zugende");
    expect((await queue(id)).map((q) => q.text)).toEqual(["am Zugende"]);
  });

  it("queue:false wählt ausdrücklich das Lenken — auch bei next-turn, wenn der Adapter lenken kann", async () => {
    const id = await create();
    const ack = await call("POST", `/api/sessions/${id}/steer`, { kind: "prompt", text: "sofort lenken", queue: false });
    expect(ack.statusCode).toBe(200);
    expect(prompts).toContain("sofort lenken"); // direkt beim Adapter, nicht vorgemerkt
    expect(await queue(id)).toEqual([]);
  });

  it("PATCH ändert den Text, und es geht die geänderte Fassung raus", async () => {
    const id = await create();
    await call("POST", `/api/sessions/${id}/steer`, { kind: "prompt", text: "ursprünglich so gemeint" });
    const [item] = await queue(id);
    expect(item).toBeDefined();
    const res = await call("PATCH", `/api/sessions/${id}/queue/${item!.id}`, { text: "korrigiert: anders gemeint" });
    expect(res.statusCode).toBe(200);
    expect((await queue(id))[0]!.text).toBe("korrigiert: anders gemeint");

    const sent = await call("POST", `/api/sessions/${id}/queue/${item!.id}/send`);
    expect(sent.statusCode).toBe(200); // next-turn + steer => sofort lenken ist erlaubt
    expect(prompts).toContain("korrigiert: anders gemeint");
    expect(prompts).not.toContain("ursprünglich so gemeint");
  });

  it("PATCH move:holt einen vorgemerkten Prompt nach vorn — er geht als nächster raus", async () => {
    const id = await create();
    await call("POST", `/api/sessions/${id}/steer`, { kind: "prompt", text: "dritte Anfrage" });
    await call("POST", `/api/sessions/${id}/steer`, { kind: "prompt", text: "wichtigste Anfrage" });
    const list = await queue(id);
    expect(list.map((q) => q.text)).toEqual(["dritte Anfrage", "wichtigste Anfrage"]);

    const res = await call("PATCH", `/api/sessions/${id}/queue/${list[1]!.id}`, { move: "front" });
    expect(res.statusCode).toBe(200);
    expect((await queue(id)).map((q) => q.text)).toEqual(["wichtigste Anfrage", "dritte Anfrage"]);

    // Beleg über die Route: "jetzt senden" erwischt den vordersten — hier den umgehängten.
    const head = (await queue(id))[0]!;
    expect((await call("POST", `/api/sessions/${id}/queue/${head.id}/send`)).statusCode).toBe(200);
    expect(prompts).toContain("wichtigste Anfrage");
    expect((await queue(id)).map((q) => q.text)).toEqual(["dritte Anfrage"]);
  });

  it("ADR-0074 bleibt heil: ohne midTurnInput bleibt „jetzt senden“ abgelehnt und vorgemerkt", async () => {
    const id = ((await call("POST", "/api/sessions", { adapter: "stubturny", project: "/tmp" })).json() as { id: string }).id;
    const q = await call("POST", `/api/sessions/${id}/steer`, { kind: "prompt", text: "kann nicht sofort", queue: false });
    expect(q.json()).toMatchObject({ ok: true, detail: "queued" }); // queue:false ohne Zusicherung: sicherer Weg
    const [item] = (await queue(id)) as { id: string }[];
    const sent = await call("POST", `/api/sessions/${id}/queue/${item!.id}/send`);
    expect(sent.statusCode).toBe(422);
    expect(sent.json()).toMatchObject({ ok: false, detail: expect.stringContaining("keine weitere Nachricht annehmen") });
    expect((await queue(id))).toHaveLength(1); // ehrlich sichtbar vorgemerkt, nichts verloren
  });

  it("move:back stellt ans Ende, move auf der Spitze ändert nichts", async () => {
    const id = await create();
    await call("POST", `/api/sessions/${id}/steer`, { kind: "prompt", text: "eins" });
    await call("POST", `/api/sessions/${id}/steer`, { kind: "prompt", text: "zwei" });
    const list = await queue(id);
    expect((await call("PATCH", `/api/sessions/${id}/queue/${list[0]!.id}`, { move: "back" })).statusCode).toBe(200);
    expect((await queue(id)).map((q) => q.text)).toEqual(["zwei", "eins"]);
    expect((await call("PATCH", `/api/sessions/${id}/queue/${list[0]!.id}`, { move: "back" })).statusCode).toBe(200);
    expect((await queue(id)).map((q) => q.text)).toEqual(["zwei", "eins"]);
  });

  it("ehrliche Antworten: leerer Text, leere Änderung, fremde Queue-Id, unbekannte Session", async () => {
    const id = await create();
    await call("POST", `/api/sessions/${id}/steer`, { kind: "prompt", text: "bleibt stehen" });
    const [item] = await queue(id);
    expect((await call("PATCH", `/api/sessions/${id}/queue/${item!.id}`, { text: "   " })).statusCode).toBe(422);
    expect((await queue(id))[0]!.text).toBe("bleibt stehen"); // abgelehnt, aber nicht gelöscht
    expect((await call("PATCH", `/api/sessions/${id}/queue/${item!.id}`, {})).statusCode).toBe(422);
    expect((await call("PATCH", `/api/sessions/${id}/queue/${item!.id}`, { quatsch: true })).statusCode).toBe(422);
    expect((await call("PATCH", `/api/sessions/${id}/queue/gibt-es-nicht`, { text: "x" })).json()).toMatchObject({
      ok: false,
      detail: "nicht mehr in der Warteschlange",
    });
    expect((await call("PATCH", "/api/sessions/gibt-es-nicht/queue/x", { text: "x" })).statusCode).toBe(404);
  });

  it("die Liste nennt die Stelle (position) — die UI kann sie nummerieren", async () => {
    const id = await create();
    await call("POST", `/api/sessions/${id}/steer`, { kind: "prompt", text: "erste" });
    await call("POST", `/api/sessions/${id}/steer`, { kind: "prompt", text: "zweite" });
    const list = await queue(id);
    expect(list.map((q) => q.position)).toEqual([list[0]!.position, list[1]!.position]);
    expect(list[0]!.position).toBeLessThan(list[1]!.position);
  });
});
