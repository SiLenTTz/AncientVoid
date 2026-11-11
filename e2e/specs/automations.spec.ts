import { createHash, randomUUID } from "node:crypto";
import { test, expect } from "../support/fixtures.ts";
import type { TestHub } from "../support/hub.ts";

/**
 * EPIC-P41 T41.6 (ADR-0064): Automationen gegen einen echten Hub — echten
 * kurzen Zeitplan-Lauf (Cron jede Minute, dummy-Harness), PWA-Ansicht,
 * Restart-Dedupe und Negativprobe. Skip-Gründe bleiben getrennt sichtbar;
 * `dispatched` ist ein Startauftrag, kein Erfolg.
 */

const PROMPT = "Schreibe eine Zeile Tagesabschluss.";
const PROMPT_SHA = createHash("sha256").update(PROMPT).digest("hex");

async function hubHostId(hub: TestHub): Promise<string> {
  const res = await hub.api<{ hostId: string }>("/api/fleet/hello");
  expect(res.status).toBe(200);
  return res.body.hostId;
}

async function createAutomation(hub: TestHub, hostId: string, over: Record<string, unknown> = {}): Promise<{ id: string; label: string }> {
  const definition = {
    id: randomUUID(),
    label: "E2E-Kurztakt",
    generation: 1,
    enabled: false,
    hostId,
    schedule: { kind: "cron", cron: "* * * * *", timezone: "UTC" },
    target: { kind: "session", harness: "dummy", workdir: "worktree", project: hub.alpha, promptBlobSha256: PROMPT_SHA },
    precheckDeadlineMs: 60_000,
    grant: { maxParallel: 1, missedGraceMs: 0 },
    createdAtUtc: new Date().toISOString(),
    ...over,
  };
  const res = await hub.api<{ id: string; label: string }>("/api/automations", { body: { definition, promptText: PROMPT } });
  expect(res.status).toBe(201);
  return res.body;
}

type ListBody = { automations: { definition: { id: string; enabled: boolean; generation: number; label: string }; lastOccurrence: { utc: string; state: string; reason?: string; sessionId?: string } | null; nextOccurrences: { utc: string }[] }[] };

async function listAutomations(hub: TestHub): Promise<ListBody["automations"]> {
  return (await hub.api<ListBody>("/api/automations")).body.automations;
}

async function historyOf(hub: TestHub, id: string): Promise<{ claimKey: string; occurrenceUtc: string; state: string; reason?: string; sessionId?: string }[]> {
  const res = await hub.api<{ history: { claimKey: string; occurrenceUtc: string; state: string; reason?: string; sessionId?: string }[] }>(`/api/automations/${id}/history`);
  expect(res.status).toBe(200);
  return res.body.history;
}

test.describe("Automationen (EPIC-P41)", () => {
  // Der minütliche Scheduler-Tick braucht echte Zeit — 45 s Projekt-Default reicht nicht.
  test.setTimeout(240_000);

  test("Geplanter Minutentakt startet einen echten dummy-Lauf; PWA zeigt Liste, Vorschau und Verlauf (AC-P41-1)", async ({ app, hub }) => {
    const hostId = await hubHostId(hub);
    const created = await createAutomation(hub, hostId);

    await app.goto(`${hub.origin}/#/automationen`);
    await expect(app.getByTestId("automations-pane")).toBeVisible();
    await expect(app.getByText("E2E-Kurztakt").first()).toBeVisible();
    await expect(app.getByTestId("automation-state").first()).toHaveText("aus"); // Neuanlage ist deaktiviert (Freigabe-Prinzip).

    // Aktivieren über die PWA — die Freigabe des gerahmten Auto-Modus.
    await app.getByRole("button", { name: "Aktivieren" }).first().click();
    await expect(app.getByTestId("automation-state").first()).toHaveText("aktiv", { timeout: 10_000 });

    // Der minütliche Scheduler-Tick feuert den geplanten Lauf (echter Kurztakt, kein run-now);
    // ADR-0065: das Turn-End rechnet belegt ab — settled ist der Endzustand, dispatched nur der Auftrag.
    await expect
      .poll(async () => (await listAutomations(hub)).find((a) => a.definition.id === created.id)?.lastOccurrence?.state ?? "", { timeout: 100_000, intervals: [3_000] })
      .toBe("settled");
    const info = (await listAutomations(hub)).find((a) => a.definition.id === created.id)!;
    expect(info.lastOccurrence?.sessionId).toBeTruthy(); // Startauftrag mit echter Session (dispatched ≠ geraten).
    expect(info.nextOccurrences.length).toBeGreaterThan(0); // Vorschau bleibt gefüllt.

    // Verlauf in der PWA: Zustand + Session-Verweis.
    await app.getByText("E2E-Kurztakt").first().click();
    await expect(app.getByTestId("automation-detail")).toBeVisible();
    await expect(app.getByTestId("automation-history")).toContainText("abgerechnet");
    await expect(app.getByTestId("automation-detail")).toContainText("Session ↗");

    // Disable stoppt zukünftige Termine (AC-P41-5), laufende Arbeit bleibt unberührt.
    await app.getByRole("button", { name: "Deaktivieren" }).first().click();
    await expect(app.getByTestId("automation-state").first()).toHaveText("aus", { timeout: 10_000 });
    expect((await listAutomations(hub)).find((a) => a.definition.id === created.id)?.definition.enabled).toBe(false);
  });

  test("Hub-Restart erhält Definition und Verlauf; kein zweiter Lauf für dieselbe Minute (AC-P41-3/6)", async ({ hub }) => {
    const hostId = await hubHostId(hub);
    const created = await createAutomation(hub, hostId, { label: "E2E-Restart" });
    const enable = await hub.api(`/api/automations/${created.id}/enable`, { body: { enabled: true, generation: 1 } });
    expect(enable.status).toBe(200);

    await expect
      .poll(async () => (await listAutomations(hub)).find((a) => a.definition.id === created.id)?.lastOccurrence?.state ?? "", { timeout: 100_000, intervals: [3_000] })
      .toBe("settled");
    const before = (await listAutomations(hub)).find((a) => a.definition.id === created.id)!;
    const occurrence = before.lastOccurrence!.utc;
    expect((await historyOf(hub, created.id)).filter((h) => h.occurrenceUtc === occurrence)).toHaveLength(1);

    // Restart (SIGTERM: sauberer Shutdown mit Journal-fsync) — Recovery adoptiert nur mit Statusprüfung.
    await hub.restart("SIGTERM");

    await expect
      .poll(async () => (await listAutomations(hub).catch(() => null))?.find((a) => a.definition.id === created.id)?.definition.enabled ?? null, { timeout: 20_000, intervals: [1_000] })
      .toBe(true); // Definition und Freigabe erhalten (AC-P41-6).
    const info = (await listAutomations(hub)).find((a) => a.definition.id === created.id)!;
    expect(info.definition.generation).toBe(1);
    expect(info.lastOccurrence?.state).toBe("settled");

    // Der Sofort-Tick nach dem Start darf dieselbe Occurrence nicht erneut starten: Dedupe über den Claim-Schlüssel.
    await expect
      .poll(async () => (await historyOf(hub, created.id)).filter((h) => h.occurrenceUtc === occurrence).length, { timeout: 10_000, intervals: [2_000] })
      .toBe(1);
  });

  test("Negativprobe: nicht registrierte Precheck-Aktion überspringt mit getrenntem Grund (AC-P41-4)", async ({ hub }) => {
    const hostId = await hubHostId(hub);
    const created = await createAutomation(hub, hostId, { label: "E2E-Precheck-Negativ", precheckActionId: "diese-aktion-existiert-nicht" });
    const enable = await hub.api(`/api/automations/${created.id}/enable`, { body: { enabled: true, generation: 1 } });
    expect(enable.status).toBe(200);

    await expect
      .poll(async () => (await listAutomations(hub)).find((a) => a.definition.id === created.id)?.lastOccurrence ?? null, { timeout: 100_000, intervals: [3_000] })
      .toMatchObject({ state: "skipped", reason: "precheck" });

    // Run-Ziele failen laut: eine unbekannte Vorlage darf keine Definition hinterlassen (ADR-0065).
    const runTarget = await hub.api("/api/automations", { body: { definition: { id: randomUUID(), label: "E2E-Run-Ziel", generation: 1, enabled: false, hostId, schedule: { kind: "preset", preset: "daily", localTime: "03:00", timezone: "UTC" }, target: { kind: "run", templateId: "es-gibt-keine" }, precheckDeadlineMs: 60_000, grant: { maxParallel: 1, missedGraceMs: 0 }, createdAtUtc: new Date().toISOString() } } });
    expect(runTarget.status).toBe(400);
  });
});
