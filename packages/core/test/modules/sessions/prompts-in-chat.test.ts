import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NormalizedEvent } from "@uacc/contracts";
import { EventStore, HubDatabase, SessionManager, AdapterRegistry, ApprovalService } from "../../../src/index.ts";
import { ProcessRunner } from "@uacc/workers";
import { createAdapter as createDummy } from "@uacc/adapter-dummy";

const prompts = (events: NormalizedEvent[]) =>
  events.filter((e) => e.type === "user").map((e) => (e.payload as { text?: string }).text);

describe("the user's own inputs appear in the chat", () => {
  it("records the start prompt and every reply once, as typed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uacc-prompts-"));
    const project = join(dir, "proj");
    await mkdir(join(project, ".claude", "skills", "neon"), { recursive: true });
    await writeFile(join(project, ".claude", "skills", "neon", "SKILL.md"), "---\nname: neon\ndescription: x\n---\nGEHEIMER SKILLTEXT\n");
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, { eventsPerSecond: 5, autoStopAfterEvents: 0 });
    const manager = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
    try {
      const record = await manager.create({ adapter: "dummy", project, prompt: "Baue das Login", args: { skill: "neon" } }, "pc");
      expect((await manager.steer(record.id, { kind: "prompt", text: "Und die Tests" }, "phone")).ok).toBe(true);
      await manager.stop(record.id);
      expect((await manager.steer(record.id, { kind: "prompt", text: "Weiter bitte" }, "pc")).ok).toBe(true);

      const events = await manager.tail(record.id, 0);
      expect(prompts(events)).toEqual(["Baue das Login", "Und die Tests", "Weiter bitte"]);
      const first = events.find((e) => e.type === "user");
      expect(first?.payload).toMatchObject({ kind: "session.prompt", actor: "pc" });
      expect(JSON.stringify(events.filter((e) => e.type === "user"))).not.toContain("GEHEIMER SKILLTEXT");
      const firstPrompt = events.findIndex((e) => e.type === "user");
      const started = events.findIndex((e) => (e.payload as { kind?: string }).kind === "session.started");
      expect(firstPrompt).toBeLessThan(started);
    } finally {
      await manager.shutdown();
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("an approved reply appears once, after the approval", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uacc-prompts-"));
    const db = new HubDatabase(":memory:");
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, { eventsPerSecond: 5, autoStopAfterEvents: 0 });
    const approvals = new ApprovalService(db);
    const manager = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner(), undefined, undefined, approvals);
    try {
      const record = await manager.create({ adapter: "dummy", project: dir });
      const ack = await manager.steer(record.id, { kind: "prompt", text: "Nur mit Freigabe" }, "phone");
      expect(prompts(await manager.tail(record.id, 0))).toEqual([]);
      const approvalId = /pending approval (\S+)/.exec(ack.detail ?? "")![1]!;
      approvals.decide(approvalId, "approve", "raw-token", "pc");
      expect((await manager.applyApprovedSteer(approvalId, "pc")).ok).toBe(true);
      expect(prompts(await manager.tail(record.id, 0))).toEqual(["Nur mit Freigabe"]);
    } finally {
      await manager.shutdown();
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
