/**
 * EPIC-P43 T43.4: erzeugt die normalisierten Ereignisströme für `apps/pwa/test/features/turns.test.ts`
 * aus den aufgezeichneten, anonymisierten Adapter-Fixtures (`packages/adapters/<a>/test/fixtures`).
 * Davor ein `session.prompt`, danach ein `session.turn_end`, fortlaufende `seq`/`ts` — so, wie der Hub
 * den Strom an die PWA ausliefert. Neu erzeugen, wenn sich ein Normalisierer ändert:
 *
 *   node scripts/turn-fixtures.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const repo = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const out = `${repo}/apps/pwa/test/fixtures/turns`;
const { normalizeClaudeLine } = await import(`${repo}/packages/adapters/claude/src/normalize.ts`);
const { normalizeCodexLine } = await import(`${repo}/packages/adapters/codex/src/normalize.ts`);
const { normalizeOpencodeLine } = await import(`${repo}/packages/adapters/opencode/src/normalize.ts`);
const { normalizeCopilotLine } = await import(`${repo}/packages/adapters/copilot/src/normalize.ts`);
const { createPiStream } = await import(`${repo}/packages/adapters/pi/src/normalize.ts`);
const lines = (p: string): unknown[] => readFileSync(`${repo}/packages/adapters/${p}`, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
interface Emitted { type: string; summary: string; payload: unknown; blobRef?: string | null }
const sets: Record<string, Emitted[]> = {
  "claude-tool-use": lines("claude/test/fixtures/tool-use.jsonl").flatMap((l: unknown) => normalizeClaudeLine(l)),
  "codex-tool-use": lines("codex/test/fixtures/tool-use.jsonl").flatMap((l: unknown) => normalizeCodexLine(l)),
  "opencode-tool-error": lines("opencode/test/fixtures/tool-error.jsonl").flatMap((l: unknown) => normalizeOpencodeLine(l)),
  "opencode-trivial-read": lines("opencode/test/fixtures/trivial-read.jsonl").flatMap((l: unknown) => normalizeOpencodeLine(l)),
  "copilot-tool-use": lines("copilot/test/fixtures/tool-use-read-file.jsonl").flatMap((l: unknown) => normalizeCopilotLine(l)),
  "copilot-tool-error": lines("copilot/test/fixtures/tool-error-read-file.jsonl").flatMap((l: unknown) => normalizeCopilotLine(l)),
  "pi-tool-use": (() => { const s = createPiStream(); return [...s.push(readFileSync(`${repo}/packages/adapters/pi/test/fixtures/tool-use.jsonl`, "utf8")), ...s.end()]; })(),
};
for (const [name, evs] of Object.entries(sets)) {
  // Wie der Hub sie ausliefert: Prompt vorn, Zugende hinten, fortlaufende seq und ts.
  const base = Date.parse("2026-11-11T08:00:00.000Z");
  const all = [{ type: "user", summary: "Auftrag", payload: { text: "Auftrag", kind: "session.prompt" } }, ...evs, { type: "system", summary: "turn end", payload: { kind: "session.turn_end" } }];
  const norm = all.map((e: Emitted, i) => ({ seq: i + 1, ts: new Date(base + i * 1000).toISOString(), sessionId: "s", type: e.type, summary: e.summary, payload: e.payload, blobRef: e.blobRef ?? null }));
  writeFileSync(`${out}/${name}.json`, JSON.stringify(norm, null, 1) + "\n");
  console.log(name, norm.length, [...new Set(norm.map((e) => e.type))].join(","));
}
