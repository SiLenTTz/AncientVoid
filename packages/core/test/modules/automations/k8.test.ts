import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, rmSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AutomationDefinition } from "@ancientvoid/contracts";
import { AutomationService, AutomationStore, CLAIM_HISTORY_KEEP } from "../../../src/modules/automations/index.ts";

/**
 * EPIC-P41 §8 Punkt 4 (K8): viele Pläne im Minutentakt dürfen den Tick nicht
 * mit der Laufzeit wachsen lassen. Belegt über Schranken (Claims, Journal),
 * die Zeitgrenze ist großzügig und nur ein Stolperdraht.
 */

// BUG-0163: Dieser Lastfall braucht lokale CPU — auf gemieteten Runnern
// lief er wiederholt ins Timeout (GitLab-Runner ~426 s, GitHub-Runner über
// 120 s hinaus; lokal ~60 s). Auf gehosteter CI sichtbar geskippt, im
// lokalen Gate Pflicht.
const HOSTED_RUNNER = process.env.AV_HOSTED_RUNNER === "1";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(r => rm(r, { recursive: true, force: true }))); });
async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "av-p41-k8-"));
  roots.push(root);
  return root;
}

const PROMPT = "Minutentakt";
const PROMPT_SHA = createHash("sha256").update(PROMPT).digest("hex");
function definition(id: string, over: Partial<AutomationDefinition> = {}): AutomationDefinition {
  return {
    id, label: id, generation: 1, enabled: true, hostId: "host",
    schedule: { kind: "cron", cron: "* * * * *", timezone: "Europe/Berlin" },
    target: { kind: "session", harness: "dummy", workdir: "worktree", project: "/tmp", promptBlobSha256: PROMPT_SHA },
    grant: { maxParallel: 1, missedGraceMs: 0 }, precheckDeadlineMs: 60_000, createdAtUtc: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}
const minute = (n: number) => new Date(Date.parse("2026-06-01T00:00:00.000Z") + n * 60_000).toISOString();

describe("Automations-Store: begrenzter Verlauf und kompaktes Journal (K8)", () => {
  it("behält je Automation die neuesten abgeschlossenen Claims und jeden offenen; Neustart sieht denselben Stand", async () => {
    const root = await tempRoot();
    const store = new AutomationStore(root);
    store.upsertDefinition(definition("a"), minute(0));
    const open = store.claim("a", 1, minute(0), minute(0))!;
    store.updateClaim(open.claimKey, { state: "unknown", detail: "Absturz" }, minute(0));
    const total = CLAIM_HISTORY_KEEP + 50;
    for (let i = 1; i <= total; i++) {
      const c = store.claim("a", 1, minute(i), minute(i))!;
      store.updateClaim(c.claimKey, { state: i % 2 ? "settled" : "skipped", ...(i % 2 ? { outcome: "succeeded" as const } : { reason: "overlap" as const }) }, minute(i));
    }
    store.saveSnapshot();

    const kept = store.claimsFor("a");
    expect(kept).toHaveLength(CLAIM_HISTORY_KEEP + 1);
    expect(kept.some(c => c.claimKey === open.claimKey && c.state === "unknown")).toBe(true);
    expect(kept.some(c => c.occurrenceUtc === minute(50))).toBe(false);
    expect(kept.some(c => c.occurrenceUtc === minute(51))).toBe(true);
    expect(store.inFlight("a")).toBe(1);
    expect(statSync(join(root, "journal.jsonl")).size).toBe(0);

    const restarted = new AutomationStore(root);
    expect(restarted.claimsFor("a").map(c => c.claimKey).sort()).toEqual(kept.map(c => c.claimKey).sort());
    expect(restarted.inFlight("a")).toBe(1);
    // Neue Einträge nach dem Kürzen landen wieder im Journal und überleben den Neustart.
    restarted.claim("a", 1, minute(total + 1), minute(total + 1));
    expect(new AutomationStore(root).claimsFor("a").some(c => c.occurrenceUtc === minute(total + 1))).toBe(true);
  });

  it("schreibt den Snapshot nur, wenn sich etwas geändert hat", async () => {
    const root = await tempRoot();
    const store = new AutomationStore(root);
    store.upsertDefinition(definition("a"), minute(0));
    store.saveSnapshot();
    rmSync(join(root, "snapshot.json"));
    store.saveSnapshot();
    expect(existsSync(join(root, "snapshot.json"))).toBe(false);
    store.claim("a", 1, minute(1), minute(1));
    store.saveSnapshot();
    expect(existsSync(join(root, "snapshot.json"))).toBe(true);
  });

  it.skipIf(HOSTED_RUNNER)("128 Pläne im Minutentakt: Claims und Journal bleiben begrenzt, der Tick wächst nicht mit der Laufzeit", async () => {
    const root = await tempRoot();
    const clock = { now: Date.parse(minute(0)) };
    const service = new AutomationService({
      root, hostId: "host", now: () => clock.now,
      launcher: { async launch() { return { ok: true, sessionId: "s" }; }, async inspect() { return { state: "settled", outcome: "succeeded" }; } },
      prechecker: { async run() { return "ok"; } },
    });
    for (let i = 0; i < 128; i++) {
      const created = service.create(definition(`a${i}`, { createdAtUtc: minute(0) }), PROMPT);
      service.setEnabled(created.id, true, 1);
    }
    const ticks: number[] = [];
    for (let m = 1; m <= CLAIM_HISTORY_KEEP + 60; m++) {
      clock.now = Date.parse(minute(m)) + 5_000;
      const t0 = performance.now();
      await service.tick();
      ticks.push(performance.now() - t0);
    }
    for (let i = 0; i < 128; i++) expect(service.history(`a${i}`).length).toBeLessThanOrEqual(CLAIM_HISTORY_KEEP + 1);
    expect(statSync(join(root, "journal.jsonl")).size).toBe(0);
    // BUG-0163: Die Messlatte ist „der Tick wächst nicht mit der Laufzeit“,
    // nicht absolute Geschwindigkeit — CI-Runner sind langsamer als Desktop-
    // Hardware. Early als Basis, late darf early nicht aus dem Ruder laufen
    // (Faktor 2 + Grundrauschen), absolute Kappe nur als grober Ausrutscher.
    const early = ticks.slice(0, 20).reduce((a, b) => a + b, 0) / 20;
    const late = ticks.slice(-20).reduce((a, b) => a + b, 0) / 20;
    expect(late).toBeLessThan(Math.max(500, early * 2));
    service.stop();
  }, 120_000);
});
