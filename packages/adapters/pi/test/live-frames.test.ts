import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { STREAM_FLUSH_INTERVAL_MS, STREAM_FLUSH_MIN_CHARS, type EmittedStreamFrame } from "@ancientvoid/contracts";
import { createPiStream } from "../src/normalize.ts";
import { createLivePump } from "@ancientvoid/contracts";

/**
 * BUG-0178 / ADR-0083: echtes Streaming statt Nacherzählen.
 * Die Aufzeichnung `tool-use.jsonl` enthält echte pi-Deltas (12x text_delta,
 * 11x thinking_delta) — genau die wurden vorher in `IGNORED_UPDATES` verworfen.
 */
const fixture = readFileSync(fileURLToPath(new URL("./fixtures/tool-use.jsonl", import.meta.url)), "utf8");

function feed(lines: string[], frames: EmittedStreamFrame[]) {
  const pump = createLivePump((f) => frames.push(f));
  const stream = createPiStream(pump);
  const events = lines.flatMap((l) => stream.push(l + "\n"));
  return { events, frames, pump };
}

function linesOf(n: number): string[] {
  return fixture.split("\n").filter((l) => l.trim()).slice(0, n);
}

describe("pi Live-Frames (BUG-0178, ADR-0083)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("die echte Aufnahme liefert Deltas — vorher gingen sie spurlos verloren", () => {
    const deltas = linesOf(400)
      .map((l) => JSON.parse(l) as { assistantMessageEvent?: { type?: string } })
      .filter((r) => r.assistantMessageEvent?.type?.endsWith("_delta")).length;
    expect(deltas).toBeGreaterThan(0);
  });

  it("ohne Pumpe bleibt es bei den Block-Ereignissen (nichts wird vorgetäuscht)", () => {
    const events = feed(linesOf(400), []).events;
    const assistant = events.filter((e) => e.type === "assistant");
    expect(assistant).toHaveLength(1);
    expect(String((assistant[0]?.payload as { text: string } | undefined)?.text)).toContain("Die Datei hat 2 Zeilen");
  });

  it("Deltas kommen als Frames raus: kohäriert, fortlaufende seq, letzter Frame final", () => {
    const frames: EmittedStreamFrame[] = [];
    const { events } = feed(linesOf(400), frames);
    const assistantFrames = frames.filter((f) => f.stream === "assistant");
    expect(assistantFrames.length).toBeGreaterThan(0);
    expect(assistantFrames.map((f) => f.seq)).toEqual([...assistantFrames.keys()]);
    expect(assistantFrames.at(-1)?.final).toBe(true);
    // kohäriert: deutlich weniger Frames als Deltas, und ihr Text ergibt den Block
    const assistantDeltas = linesOf(400).filter((l) => String(l).includes('"text_delta"')).length;
    expect(assistantFrames.length).toBeLessThan(assistantDeltas + 1);
    expect(assistantFrames.map((f) => f.text).join("")).toContain("Die Datei hat 2 Zeilen");
    // und der Block bleibt das eine persistierte Ereignis
    expect(events.filter((e) => e.type === "assistant")).toHaveLength(1);
  });

  it("Größen-Flush kommt ohne Warten, Zeit-Flush nach dem Intervall", () => {
    const frames: EmittedStreamFrame[] = [];
    const pump = createLivePump((f) => frames.push(f));
    pump.begin("assistant");
    for (let i = 0; i < 60; i++) pump.delta("assistant", "abcdefghij"); // 600 Zeichen
    expect(frames).toHaveLength(0);
    pump.delta("assistant", "x".repeat(STREAM_FLUSH_MIN_CHARS - 600 + 1));
    expect(frames.length).toBe(1); // Größen-Flush, ohne dass die Uhr lief
    expect(frames[0]?.text.length ?? 0).toBeGreaterThanOrEqual(STREAM_FLUSH_MIN_CHARS);

    pump.delta("assistant", "gleich");
    vi.advanceTimersByTime(STREAM_FLUSH_INTERVAL_MS - 10);
    expect(frames).toHaveLength(1);
    vi.advanceTimersByTime(20);
    expect(frames).toHaveLength(2);
    expect(frames[1]?.text).toBe("gleich");
  });

  it("close() schneidet offene Timer ab — nach Prozess-Ende kommt kein Frame mehr", () => {
    const frames: EmittedStreamFrame[] = [];
    const pump = createLivePump((f) => frames.push(f));
    pump.begin("thinking");
    pump.delta("thinking", "halbe Zeile");
    pump.close();
    vi.advanceTimersByTime(STREAM_FLUSH_INTERVAL_MS * 3);
    expect(frames).toHaveLength(0);
  });

  it("thinking-Deltas laufen als eigener Stream, ohne den assistant-Block zu stören", () => {
    const frames: EmittedStreamFrame[] = [];
    const { events } = feed(linesOf(400), frames);
    const think = frames.filter((f) => f.stream === "thinking");
    expect(think.length).toBeGreaterThan(0);
    expect(think.at(-1)?.final).toBe(true);
    expect(events.filter((e) => e.type === "thinking")).toHaveLength(2);
    const turnIds = new Set(think.map((f) => f.turnId));
    expect(turnIds.size).toBe(2); // zwei denkende Blöcke = zwei Serien
  });
});
