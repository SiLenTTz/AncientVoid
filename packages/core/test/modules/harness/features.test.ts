import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { basicFeatures, type Adapter } from "@ancientvoid/contracts";
import { AdapterRegistry } from "../../../src/modules/harness/registry.ts";
import { EventStore } from "../../../src/platform/eventstore.ts";
import { HubDatabase } from "../../../src/platform/db.ts";
import { SessionManager } from "../../../src/modules/sessions/session-manager.ts";
import { refuseSpec, refuseSteer } from "../../../src/modules/harness/features.ts";
import { ProcessRunner } from "@ancientvoid/workers";

describe("ADR-0018: the server refuses what a harness can't do", () => {
  it("names the reason for model, agent, follow-up and park", () => {
    const none = basicFeatures({ followUp: false, interrupt: false });
    expect(refuseSpec(none, "aider", { model: "x" })).toBe("aider kann beim Start kein Modell wählen.");
    expect(refuseSpec(none, "aider", { args: { agent: "reviewer" } })).toBe("aider kennt keine Agenten.");
    expect(refuseSpec(basicFeatures({ modelChoice: "start", agents: true }), "claude", { model: "opus", args: { agent: "r" } })).toBeNull();
    expect(refuseSteer(none, "aider", { kind: "prompt", text: "weiter" })).toBe("aider nimmt keine weiteren Eingaben an.");
    expect(refuseSteer(none, "aider", { kind: "park" })).toBe("aider kann einen laufenden Zug nicht anhalten.");
    expect(refuseSteer(none, "aider", { kind: "stop" })).toBeNull();
  });

  it("AC-P7-4: an observer gets no attachments — said before anything is sent", () => {
    const att = [{ id: "a".repeat(64), name: "x.png", mimeType: "image/png", kind: "image" as const, bytes: 3, path: "/x", text: null, method: null }];
    expect(refuseSpec(basicFeatures({ followUp: false, interrupt: false }), "claude-clip", { attachments: att })).toBe("claude-clip beobachtet nur — Anhänge kommen dort nicht an.");
    // A harness without native images still gets the extracted text (T7.10).
    expect(refuseSpec(basicFeatures({ followUp: true, interrupt: true, images: false }), "aider", { attachments: att })).toBeNull();
  });

  it("SessionManager refuses before the adapter sees the request", async () => {
    const root = await mkdtemp(join(tmpdir(), "ancientvoid-features-"));
    const calls: string[] = [];
    const adapter: Adapter = {
      id: "observer",
      version: "0.0.1",
      capabilities: () => ({
        reasoning: false,
        tools: false,
        cost: false,
        steer: false,
        usage: false,
        nativeDiscovery: "none",
        nativeResume: "none",
        features: basicFeatures({ followUp: false, interrupt: false }),
      }),
      async start(_spec, ctx) {
        calls.push("start");
        return { sessionId: ctx.sessionId };
      },
      async steer(_h, input) {
        calls.push(`steer:${input.kind}`);
        return { ok: true };
      },
      async status() {
        return { state: "healthy" };
      },
      async stop() {
        calls.push("stop");
      },
    };
    const registry = new AdapterRegistry();
    registry.register("observer", () => adapter);
    const sessions = new SessionManager(new HubDatabase(":memory:"), new EventStore(root), registry, new ProcessRunner());
    try {
      await expect(sessions.create({ adapter: "observer", project: root, model: "gpt" })).rejects.toThrow("observer kann beim Start kein Modell wählen.");
      expect(calls).toEqual([]);
      const record = await sessions.create({ adapter: "observer", project: root });
      const ack = await sessions.steer(record.id, { kind: "prompt", text: "hallo" });
      expect(ack).toEqual({ ok: false, detail: "observer nimmt keine weiteren Eingaben an." });
      expect(calls).toEqual(["start"]);
    } finally {
      await sessions.shutdown();
      await rm(root, { recursive: true, force: true });
    }
  });
});
