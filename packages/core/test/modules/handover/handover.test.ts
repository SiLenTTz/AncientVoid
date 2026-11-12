import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Adapter, NormalizedEvent } from "@ancientvoid/contracts";
import { basicFeatures } from "@ancientvoid/contracts";
import { EventStore, HubDatabase, SessionManager, AdapterRegistry } from "../../../src/index.ts";
import { buildHandoverPrompt, HANDOVER_PROMPT_MAX, redactSecrets } from "../../../src/modules/handover/index.ts";
import { ProcessRunner } from "@ancientvoid/workers";

let seq = 0;
const ev = (type: NormalizedEvent["type"], payload: Record<string, unknown> = {}, summary = type as string): NormalizedEvent => ({
  seq: ++seq, ts: "2026-10-27T10:00:00.000Z", sessionId: "s1", type, summary, payload, blobRef: null,
});

describe("buildHandoverPrompt", () => {
  it("nennt Auftrag, letzte Eingabe, letzte Antworten, Werkzeuge und den Grund", () => {
    seq = 0;
    const events = [
      ev("user", { kind: "session.prompt", text: "Baue die Suche um" }),
      ev("tool_use", { name: "Edit" }), ev("tool_use", { name: "Edit" }), ev("tool_use", { name: "Bash" }),
      ev("assistant", { text: "Ich habe die Suche umgebaut" }),
      ev("user", { kind: "session.prompt", text: "Und jetzt die Tests" }),
      ev("assistant", { text: "Tests laufen" }),
    ];
    const text = buildHandoverPrompt(events, { adapter: "claude", model: "opus", reason: { title: "Rate-Limit des Providers", detail: "Zu viele Anfragen." } });
    expect(text).toContain("claude (opus)");
    expect(text).toContain("Grund: Rate-Limit des Providers");
    expect(text).toMatch(/Ursprünglicher Auftrag:\nBaue die Suche um/);
    expect(text).toMatch(/Letzte Eingabe:\nUnd jetzt die Tests/);
    expect(text).toContain("- Tests laufen");
    expect(text).toContain("Edit ×2, Bash ×1");
    expect(text).toContain("git status");
  });

  it("bleibt unter 4 KB und schwärzt Schlüssel", () => {
    seq = 0;
    const events = [
      ev("user", { kind: "session.prompt", text: `Nutze sk-abcdefghijklmnop1234567890 und token=geheim12345678 ${"x".repeat(5000)}` }),
      ...Array.from({ length: 10 }, () => ev("assistant", { text: "y".repeat(2000) })),
    ];
    const text = buildHandoverPrompt(events, { adapter: "codex", model: null });
    expect(text.length).toBeLessThanOrEqual(HANDOVER_PROMPT_MAX);
    expect(text).not.toContain("sk-abcdefghijklmnop1234567890");
    expect(text).not.toContain("geheim12345678");
    expect(text).toContain("[entfernt]");
  });

  it("redactSecrets lässt normalen Text unberührt", () => {
    expect(redactSecrets("Bearer abcdefghijklmnopqrstuvwxyz0123")).toBe("[entfernt]");
    expect(redactSecrets("keine Geheimnisse, nur Text 12345")).toBe("keine Geheimnisse, nur Text 12345");
  });
});

const quiet = (id: string): Adapter => ({
  id,
  version: "0.0.1",
  capabilities: () => ({ reasoning: false, tools: false, cost: false, steer: true, usage: false, nativeDiscovery: "none", nativeResume: "none", features: basicFeatures({ followUp: true, interrupt: true, modelChoice: "start" }) }),
  async start(_spec, ctx) {
    ctx.emit({ type: "system", summary: "codex: Rate-Limit des Providers", payload: { kind: "provider.error", category: "rate_limit", title: "Rate-Limit des Providers", detail: "Zu viele Anfragen." } });
    await ctx.spawnWorker(["sh", "-c", "sleep 0.1"]);
    return { sessionId: ctx.sessionId };
  },
  async steer() {
    return { ok: true };
  },
  async status() {
    return { state: "healthy" };
  },
  async stop() {},
});

describe("SessionManager.handover (EPIC-P21 T21.2)", () => {
  it("startet die neue Session beim anderen Adapter, verlinkt beide und schlägt den Grund vor", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-handover-"));
    const registry = new AdapterRegistry();
    registry.register("alt", () => quiet("alt"));
    registry.register("neu", () => quiet("neu"));
    const manager = new SessionManager(new HubDatabase(":memory:"), new EventStore(dir), registry, new ProcessRunner());
    try {
      const source = await manager.create({ adapter: "alt", project: dir, prompt: "Aufgabe X" });
      const draft = await manager.handoverDraft(source.id);
      expect(draft.reason).toMatchObject({ category: "rate_limit", title: "Rate-Limit des Providers" });
      expect(draft.prompt).toContain("Aufgabe X");
      expect(draft.prompt).toContain("Grund: Rate-Limit des Providers");

      const target = await manager.handover(source.id, { adapter: "neu", model: "m1", prompt: draft.prompt }, "tester");
      expect(target).toMatchObject({ adapter: "neu", model: "m1", project: dir });
      expect(target.id).not.toBe(source.id);

      const out = (await manager.tail(source.id, 0)).find((e) => (e.payload as { kind?: string }).kind === "session.handover_out");
      expect(out?.payload).toMatchObject({ toSessionId: target.id, adapter: "neu" });
      const inn = (await manager.tail(target.id, 0)).find((e) => (e.payload as { kind?: string }).kind === "session.handover_in");
      expect(inn?.payload).toMatchObject({ fromSessionId: source.id, adapter: "alt" });
      expect((await manager.tail(target.id, 0)).some((e) => e.type === "user" && String(e.summary).includes("Aufgabe X"))).toBe(true);

      await expect(manager.handover(source.id, { adapter: "neu", prompt: "" })).rejects.toThrow(/1–3500/);
      await expect(manager.handover(source.id, { adapter: "gibt-es-nicht", prompt: "x" })).rejects.toThrow();
      await expect(manager.handoverDraft("unbekannt")).rejects.toThrow(/unknown session/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("BUG-0126: eine verlorene Provider-Session wird als Grund „session“ erkannt", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-handover-lost-"));
    let lost = false;
    const flaky: Adapter = {
      ...quiet("flaky"),
      async start(spec, ctx) {
        const resume = ((spec.args ?? {}) as { resumeSessionId?: unknown }).resumeSessionId;
        if (lost && resume === "native_weg") {
          ctx.emit({ type: "system", summary: "flaky: Start fehlgeschlagen", payload: { kind: "session.start_failed", error: "Resource not found: not found: native_weg" } });
          throw new Error("Resource not found: not found: native_weg");
        }
        ctx.emit({ type: "system", summary: "flaky · Session", payload: { kind: "acp.native_session", nativeSessionId: "native_weg" } });
        return { sessionId: ctx.sessionId };
      },
    };
    const registry = new AdapterRegistry();
    registry.register("flaky", () => flaky);
    const manager = new SessionManager(new HubDatabase(":memory:"), new EventStore(dir), registry, new ProcessRunner());
    try {
      const source = await manager.create({ adapter: "flaky", project: dir, prompt: "Aufgabe Y" });
      await manager.stop(source.id, "tester");
      lost = true;
      await manager.steer(source.id, { kind: "prompt", text: "Bitte setze die unterbrochene Arbeit fort." }, "jan-pixel");
      const draft = await manager.handoverDraft(source.id);
      expect(draft.reason).toMatchObject({ category: "session", title: "Provider-Session verloren" });
      expect(draft.prompt).toContain("Grund: Provider-Session verloren");
      expect(draft.prompt).toContain("Aufgabe Y");
    } finally {
      await manager.shutdown();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
