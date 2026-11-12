import { createHash, randomUUID } from "node:crypto";
import { test, expect } from "../support/fixtures.ts";
import type { TestHub } from "../support/hub.ts";
import type { AutomationDefinition, AutomationHistoryEntry } from "@ancientvoid/contracts";

/**
 * EPIC-P41 §8 Punkt 3: die Ergebnisabrechnung hängt am `session.turn_end` des
 * SessionManagers, nicht am Harness. Belegt bisher nur mit dem In-Process-dummy —
 * hier mit dem prozessbasierten opencode-Adapter (echter Worker, echter Exit-Code).
 */
async function runOnce(hub: TestHub, promptText: string): Promise<AutomationHistoryEntry> {
  const host = await hub.api<{ hostId: string }>("/api/fleet/hello");
  const definition = { id: randomUUID(), label: promptText, generation: 1, enabled: false, hostId: host.body.hostId,
    schedule: { kind: "preset", preset: "daily", localTime: "09:00", timezone: "Europe/Berlin" },
    target: { kind: "session", harness: "opencode", workdir: "worktree", project: hub.alpha, promptBlobSha256: createHash("sha256").update(promptText).digest("hex") },
    grant: { maxParallel: 1, missedGraceMs: 0 }, createdAtUtc: new Date().toISOString(),
  };
  const created = await hub.api<AutomationDefinition>("/api/automations", { body: { definition, promptText } });
  expect(created.status).toBe(201);
  const claim = await hub.api<AutomationHistoryEntry>(`/api/automations/${definition.id}/run-now`, { body: { generation: 1 } });
  expect(claim.status).toBe(202);
  let entry: AutomationHistoryEntry | undefined;
  await expect.poll(async () => {
    const { body } = await hub.api<{ history: AutomationHistoryEntry[] }>(`/api/automations/${definition.id}/history`);
    entry = body.history.find((h) => h.claimKey === claim.body.claimKey);
    return entry?.state;
  }, { timeout: 20_000 }).toBe("settled");
  return entry!;
}

test("P41: ein erfolgreicher opencode-Zug wird als erfolgt abgerechnet und verweist auf seine Session", async ({ hub }) => {
  const entry = await runOnce(hub, "README zusammenfassen");
  expect(entry.outcome).toBe("succeeded");
  const session = await hub.api<{ adapter: string; status: string }>(`/api/sessions/${entry.sessionId}`);
  expect(session.body).toMatchObject({ adapter: "opencode", status: "idle" });
});

test("P41: ein opencode-Zug mit Exit-Code ≠ 0 wird als fehlgeschlagen abgerechnet, nicht als erfolgt", async ({ hub }) => {
  const entry = await runOnce(hub, "Bitte FEHLER auslösen");
  expect(entry.outcome).toBe("failed");
  expect((await hub.api<{ adapter: string }>(`/api/sessions/${entry.sessionId}`)).body.adapter).toBe("opencode");
});
