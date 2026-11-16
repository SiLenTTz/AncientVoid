import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../support/fixtures.ts";
import type { TestHub } from "../support/hub.ts";
import type { AutomationDefinition, AutomationHistoryEntry } from "@ancientvoid/contracts";

/**
 * EPIC-P41 §8 Punkt 2 / AC-P41-3: echter Prozess-Absturz zwischen Claim und
 * Dispatch. Eine langsame Vorprüfung hält das Fenster offen, in dem der Claim
 * schon dauerhaft geschrieben, der Start aber noch nicht erfolgt ist.
 */
async function slowPlan(hub: TestHub, sleep: string): Promise<AutomationDefinition> {
  writeFileSync(join(hub.beta, "package.json"), JSON.stringify({ name: "beta", scripts: { "check-slow": `sleep ${sleep}` } }));
  const host = await hub.api<{ hostId: string }>("/api/fleet/hello");
  const promptText = "Nie gestartet";
  const definition = { id: randomUUID(), label: "Langsame Vorprüfung", generation: 1, enabled: false, hostId: host.body.hostId,
    schedule: { kind: "preset", preset: "daily", localTime: "09:00", timezone: "Europe/Berlin" },
    target: { kind: "session", harness: "dummy", workdir: "worktree", project: hub.beta, promptBlobSha256: createHash("sha256").update(promptText).digest("hex") },
    precheckActionId: "npm-check-slow", precheckDeadlineMs: 120_000,
    grant: { maxParallel: 1, missedGraceMs: 0 }, createdAtUtc: new Date().toISOString(),
  };
  const res = await hub.api<AutomationDefinition>("/api/automations", { body: { definition, promptText } });
  expect(res.status).toBe(201);
  return res.body;
}

const history = async (hub: TestHub, id: string) => (await hub.api<{ history: AutomationHistoryEntry[] }>(`/api/automations/${id}/history`)).body.history;
const runNow = (hub: TestHub, plan: AutomationDefinition) => hub.api<AutomationHistoryEntry>(`/api/automations/${plan.id}/run-now`, { body: { generation: plan.generation } });

const sleeping = (sleep: string) => { try { execFileSync("pgrep", ["-f", `sleep ${sleep}`]); return true; } catch { return false; } };
const stopSleep = (sleep: string) => { try { execFileSync("pkill", ["-f", `sleep ${sleep}`]); } catch { /* schon beendet */ } };

/** Run-now, warten bis die Vorprüfung wirklich läuft, dann SIGKILL und Neustart. */
async function crashInPrecheck(hub: TestHub, sleep: string): Promise<{ plan: AutomationDefinition; claimKey: string }> {
  const plan = await slowPlan(hub, sleep);
  const claim = await runNow(hub, plan);
  expect(claim.status).toBe(202);
  expect(claim.body.state).toBe("claimed");
  await hub.until(async () => sleeping(sleep), "Vorprüfung läuft");
  expect((await history(hub, plan.id))[0]).toMatchObject({ claimKey: claim.body.claimKey, state: "claimed" });
  await hub.restart("SIGKILL");
  stopSleep(sleep);
  return { plan, claimKey: claim.body.claimKey };
}

const sleepFor = () => `97.${Math.floor(Math.random() * 900 + 100)}`;

test("AC-P41-3: SIGKILL zwischen Claim und Dispatch — nach dem Neustart unklar, kein Replay, der Plan bleibt belegt", async ({ hub }) => {
  test.setTimeout(90_000);
  const sleep = sleepFor();
  try {
    const { plan, claimKey } = await crashInPrecheck(hub, sleep);
    const [entry] = await history(hub, plan.id);
    expect(entry).toMatchObject({ claimKey, state: "unknown" });
    expect(entry!.detail).toContain("kein Replay");
    expect(entry!.sessionId).toBeUndefined();
    expect(await hub.sessions()).toEqual([]);
    // Unklar belegt das Budget: ein weiterer Start wird als Überschneidung übersprungen, nicht gestartet.
    const again = await runNow(hub, plan);
    await expect.poll(async () => (await history(hub, plan.id)).find((h) => h.claimKey === again.body.claimKey)?.reason).toBe("overlap");
    expect(sleeping(sleep)).toBe(false);
    expect(await hub.sessions()).toEqual([]);
  } finally {
    stopSleep(sleep);
  }
});

test("ADR-0072: den unklaren Start in der PWA mit Notiz aufgeben — der Plan startet wieder", async ({ app, hub }) => {
  test.setTimeout(90_000);
  const sleep = sleepFor();
  try {
    const { plan, claimKey } = await crashInPrecheck(hub, sleep);
    await app.goto(`${hub.origin}/#/automationen`);
    await app.getByRole("button", { name: /Langsame Vorprüfung/ }).click();
    const historyList = app.getByTestId("automation-history");
    await expect(historyList).toContainText("Start unklar");
    await historyList.getByRole("button", { name: "Aufgeben…" }).click();
    const submit = historyList.getByRole("button", { name: "Als aufgegeben abschließen" });
    await expect(submit).toBeDisabled();
    await historyList.getByLabel("Notiz (warum aufgeben?)").fill("Hub abgestürzt, nichts gestartet");
    await submit.click();
    await expect(historyList).toContainText("Ergebnis: aufgegeben");
    await expect(historyList).toContainText("manuell aufgegeben: Hub abgestürzt, nichts gestartet");
    await expect(historyList.getByRole("button", { name: "Aufgeben…" })).toHaveCount(0);
    expect((await history(hub, plan.id)).find((h) => h.claimKey === claimKey)).toMatchObject({ state: "settled", outcome: "abandoned" });

    // Das Budget ist frei: der nächste Start läuft wieder in die Vorprüfung statt in „Überschneidung“.
    const again = await runNow(hub, plan);
    await hub.until(async () => sleeping(sleep), "neue Vorprüfung läuft");
    expect((await history(hub, plan.id)).find((h) => h.claimKey === again.body.claimKey)).toMatchObject({ state: "claimed" });
  } finally {
    stopSleep(sleep);
  }
});
