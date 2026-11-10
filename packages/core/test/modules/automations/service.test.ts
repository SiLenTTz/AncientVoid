import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AutomationService, type AutomationLauncher, type AutomationPrechecker } from "../../../src/modules/automations/index.ts";
import type { AutomationDefinition } from "@ancientvoid/contracts";

/**
 * EPIC-P41 T41.4: Der Dienst über Store und Scheduler — neue Definitionen
 * beginnen deaktiviert, wesentliche Änderungen invalidieren die Freigabe,
 * und der Prompt läuft als Blob durch (K5: Definition trägt nur den SHA).
 */

const PROMPT = "Fasse die offenen Punkte des Triage-Boards zusammen.";
const PROMPT_SHA = createHash("sha256").update(PROMPT).digest("hex");

function definition(over: Partial<AutomationDefinition> = {}): AutomationDefinition {
  return {
    id: "aut-svc",
    label: "Tageszusammenfassung",
    generation: 1,
    enabled: false,
    hostId: "host-a",
    schedule: { kind: "cron", cron: "0 8 * * *", timezone: "Europe/Berlin" },
    target: { kind: "session", harness: "pi", workdir: "worktree", project: "/srv/repo", promptBlobSha256: PROMPT_SHA },
    grant: { maxParallel: 1, missedGraceMs: 0 },
    precheckDeadlineMs: 60_000,
    createdAtUtc: "2026-01-05T10:00:00.000Z",
    ...over,
  };
}

interface Harness {
  service: AutomationService;
  launched: { claimKey: string; kind: string; promptText: string | null }[];
  prechecks: string[];
}

async function harness(opts: { ok?: boolean } = {}): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), "av-automations-svc-"));
  const launched: Harness["launched"] = [];
  const prechecks: string[] = [];
  const launcher: AutomationLauncher = {
    async launch(_def, promptText, claimKey, kind) {
      launched.push({ claimKey, kind, promptText });
      return opts.ok === false ? { ok: false, reason: "quota" } : { ok: true, sessionId: `sess-${launched.length}` };
    },
  };
  const prechecker: AutomationPrechecker = {
    async run(actionId) {
      prechecks.push(actionId);
      return null;
    },
  };
  return { service: new AutomationService({ root, hostId: "host-a", launcher, prechecker }), launched, prechecks };
}

describe("automation service (T41.4)", () => {
  it("does not accept activation supplied during creation", async () => {
    const h = await harness();
    expect(h.service.create(definition({ enabled: true }), PROMPT).enabled).toBe(false);
  });

  it("starts disabled, validates the prompt blob and dispatches run-now with the blob text", async () => {
    const h = await harness();
    const created = h.service.create(definition(), PROMPT);
    expect(created.enabled).toBe(false);
    const claim = await h.service.runNow("aut-svc");
    expect(claim).not.toBeNull();
    expect(h.launched).toHaveLength(1);
    expect(h.launched[0]!.kind).toBe("run_now");
    expect(h.launched[0]!.promptText).toBe(PROMPT); // K5: Die Definition trägt nur den SHA, der Text kommt aus dem Blob.
    expect(claim!.state).toBe("dispatched");
    expect(claim!.sessionId).toBe("sess-1");
    expect(h.service.history("aut-svc")[0]!.state).toBe("dispatched");
  });

  it("a prompt that does not match its blob SHA fails loud at creation", async () => {
    const h = await harness();
    expect(() => h.service.create(definition(), "anderer Text")).toThrow(/passt nicht/);
  });

  it("a session target without prompt text cannot be created new (the blob check needs it)", async () => {
    const h = await harness();
    expect(() => h.service.create(definition())).toThrow(/Prompt-Text/);
  });

  it("a material change bumps the generation and revokes the activation; enabling alone does not", async () => {
    const h = await harness();
    const created = h.service.create(definition(), PROMPT);
    const enabled = h.service.setEnabled(created.id, true);
    expect(enabled!.enabled).toBe(true);
    expect(enabled!.generation).toBe(created.generation); // die Freigabe selbst invalidiert sich nicht

    const renamed = h.service.update(created.id, { ...created, label: "Neuer Name", enabled: true });
    expect(renamed!.generation).toBe(created.generation + 1); // alles außer enabled ist wesentlich (Store-Regel)
    expect(renamed!.enabled).toBe(false); // damit ist die Freigabe invalidiert

    const moved = h.service.update(created.id, { ...renamed!, schedule: { kind: "cron", cron: "30 6 * * *", timezone: "Europe/Berlin" }, enabled: true });
    expect(moved!.generation).toBe(renamed!.generation + 1);
    expect(moved!.enabled).toBe(false);
  });

  it("dispatch failures keep their separate reasons and land in the history", async () => {
    const h = await harness({ ok: false });
    h.service.create(definition({ precheckActionId: "gate" }), PROMPT);
    const claim = await h.service.runNow("aut-svc");
    expect(h.prechecks).toEqual(["gate"]); // vor dem Dispatch wird der Precheck gefragt
    expect(claim!.state).toBe("skipped");
    expect(claim!.reason).toBe("quota");
  });

  it("list reports the definition, the next occurrences and the last result", async () => {
    const h = await harness();
    h.service.create(definition(), PROMPT);
    await h.service.runNow("aut-svc");
    const row = h.service.list().find((a) => a.definition.id === "aut-svc")!;
    expect(row.nextOccurrences.length).toBeGreaterThan(0);
    expect(row.lastOccurrence!.state).toBe("dispatched");
    expect(row.lastOccurrence!.sessionId).toBe("sess-1");
  });
});
