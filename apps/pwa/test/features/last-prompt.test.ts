import { describe, expect, it } from "vitest";
import {
  lastUserPrompt,
  tailWindow,
  recoverUserPrompt,
} from "../../src/features/session/last-prompt.ts";
import type { NormalizedEvent } from "../../src/shared/ws.ts";
import type { HubApi } from "../../src/shared/api.ts";

const event = (seq: number, type = "assistant"): NormalizedEvent => ({
  seq,
  type,
  summary: type,
  payload: { text: type },
  sessionId: "s",
  ts: "2026-11-13T00:00:00Z",
  blobRef: null,
});

describe("letzter Nutzerauftrag in der begrenzten Projektion", () => {
  it("behält genau den letzten Auftrag in chronologischer Reihenfolge und begrenzt die Größe", () => {
    const events = [
      event(1, "user"),
      event(2),
      event(3, "user"),
      ...Array.from({ length: 600 }, (_, i) => event(i + 4)),
    ];
    const tail = tailWindow(events, 500);
    expect(tail).toHaveLength(500);
    expect(tail[0]?.seq).toBe(3);
    expect(tail.at(-1)?.seq).toBe(603);
    expect(lastUserPrompt(tail)?.seq).toBe(3);
    expect(tailWindow(tail, 150)[0]?.seq).toBe(3);
  });
  it("hält das, was der Leser hochgeladen hat, und begrenzt nur, was darüber liegt (BUG-0211)", () => {
    const alle = Array.from({ length: 900 }, (_, i) => event(i + 1));
    const fenster = tailWindow(alle, 500); // Standard: nur die jüngsten 500
    expect(fenster).toHaveLength(500);
    expect(fenster[0]?.seq).toBe(401);

    // Leser scrollt hoch und holt 101..400 dazu: ab dort wird nichts mehr verworfen.
    const hoeher = tailWindow([...alle.slice(100, 400), ...fenster], 500, 101);
    expect(hoeher[0]?.seq).toBe(101);
    expect(hoeher).toHaveLength(800);

    // Einlaufende neue Ereignisse dürfen die geladene Unterkanze nicht wegwerfen.
    const danach = tailWindow([...hoeher, event(901), event(902)], 500, 101);
    expect(danach[0]?.seq).toBe(101);
    expect(danach.at(-1)?.seq).toBe(902);
    expect(danach).toHaveLength(802);

    // Ohne geladene Unterkanze gilt weiter die alte Grenze — K2 bleibt geschützt.
    expect(tailWindow(alle, 500, 0)[0]?.seq).toBe(401);
    expect(tailWindow(danach, 150, 0)[0]?.seq).toBe(753);
  });

  it("ersetzt den alten Auftrag beim nächsten Nutzertext und bleibt ohne Auftrag begrenzt", () => {
    const events = Array.from({ length: 510 }, (_, i) => event(i));
    expect(lastUserPrompt(events)).toBeNull();
    expect(tailWindow(events, 500)[0]?.seq).toBe(10);
    const prompt = event(510, "user");
    expect(lastUserPrompt(tailWindow([...events, prompt], 500))).toBe(prompt);
  });
  it("sucht ältere Seiten bis zur Baseline und nimmt keinen neueren Auftrag vorweg", async () => {
    const events = [
      event(1, "user"),
      ...Array.from({ length: 1999 }, (_, i) => event(i + 2)),
      event(2001, "user"),
      event(2002),
      event(2003, "user"),
    ];
    const calls: number[] = [];
    const api = {
      events: async (_id: string, after: number) => {
        calls.push(after);
        return events.filter((e) => e.seq > after).slice(0, 2000);
      },
    } as HubApi;
    expect((await recoverUserPrompt(api, "s", 2003, () => false))?.seq).toBe(
      2001,
    );
    expect(calls).toEqual([0, 2000]);
    expect(await recoverUserPrompt(api, "s", 2003, () => true)).toBeNull();
  });
});
