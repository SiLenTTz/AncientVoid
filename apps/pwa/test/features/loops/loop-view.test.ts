import { describe, expect, it } from "vitest";
import type { NormalizedEvent } from "../../../src/shared/ws.ts";
import { deriveLoopView, loopBadge } from "../../../src/features/loops/loop-view.ts";

let seq = 0;
const ev = (payload: Record<string, unknown>): NormalizedEvent => ({ seq: ++seq, ts: "2026-10-28T10:00:00Z", sessionId: "s", type: "system", summary: "", payload, blobRef: null });

describe("deriveLoopView (T19.6)", () => {
  it("ohne Loop-Ereignisse bleibt alles leer — nichts wird erfunden", () => {
    const v = deriveLoopView([ev({ other: 1 }), { ...ev({ kind: "loop.info" }), type: "assistant" }]);
    expect(v).toMatchObject({ line: null, mode: null, progress: null, gate: null, hold: null, broken: [], report: null, paused: false });
  });

  it("faltet Info, Fortschritt, Gate und Befehle; Späteres überschreibt Früheres", () => {
    const v = deriveLoopView([
      ev({ kind: "loop.info", line: "alpha", mode: "supervised", activity: "working" }),
      ev({ kind: "loop.progress", done: 1, total: 4, phase: "Act", gate: { name: "ci", state: "running" } }),
      ev({ kind: "loop.progress", done: 2, total: 4, phase: "Review", gate: { name: "ci", state: "passed" } }),
      ev({ kind: "loop.command", command: "set-mode", mode: "dark" }),
      ev({ kind: "loop.command", command: "pause" }),
    ]);
    expect(v).toMatchObject({ line: "alpha", mode: "dark", paused: true, lastCommand: "pause" });
    expect(v.progress).toEqual({ done: 2, total: 4, phase: "Review", step: null, source: null });
    expect(v.gate).toEqual({ name: "ci", state: "passed" });
  });

  it("Störungen und Halt bleiben bis loop.recovered, einzeln oder gesammelt", () => {
    const base = [ev({ kind: "loop.broken", reason: "A" }), ev({ kind: "loop.broken", reason: "B" }), ev({ kind: "loop.hold", reason: "Gates rot" })];
    expect(deriveLoopView(base)).toMatchObject({ broken: ["A", "B"], hold: "Gates rot" });
    expect(deriveLoopView([...base, ev({ kind: "loop.recovered", reason: "A" })]).broken).toEqual(["B"]);
    expect(deriveLoopView([...base, ev({ kind: "loop.recovered", all: true })]).broken).toEqual([]);
    expect(deriveLoopView([...base, ev({ kind: "loop.recovered", what: "hold" })]).hold).toBeNull();
  });

  it("bei mehreren Sessions einer Linie zählt die, an der gerade gearbeitet wird", () => {
    const v = deriveLoopView([
      ev({ kind: "loop.state", session: "neu", state: "working" }),
      ev({ kind: "loop.progress", session: "neu", done: 2, total: 5 }),
      ev({ kind: "loop.progress", session: "alt", done: 6, total: 6 }),
    ]);
    expect(v.progress).toMatchObject({ done: 2, total: 5 });
    expect(deriveLoopView([ev({ kind: "loop.progress", session: "alt", done: 6, total: 6 })]).progress).toMatchObject({ done: 6 });
  });

  it("Hermes: Freigaben des Orchestrators (nur Wahrheitswerte) und Hinweis", () => {
    const v = deriveLoopView([ev({ kind: "loop.progress", source: "hermes", done: 1, total: 2, userGates: { push: false, merge: true, junk: "x" }, gateNote: "kein Push" })]);
    expect(v.orchestrator).toEqual({ userGates: { push: false, merge: true }, note: "kein Push" });
  });

  it("Stats, Bericht (Text oder Blob), Eskalationen (die letzten fünf)", () => {
    const notices = Array.from({ length: 7 }, (_, i) => ev({ kind: "loop.notify", level: "2", reason: `r${i}`, at: "t" }));
    const v = deriveLoopView([ev({ kind: "loop.stats", completed: 3, inProgress: 1 }), ev({ kind: "loop.report", blob: "abc", counts: { merged: 2, kaputt: "x" } }), ...notices]);
    expect(v.stats).toEqual({ completed: 3, inProgress: 1 });
    expect(v.report).toEqual({ text: null, blob: "abc", counts: { merged: 2 } });
    expect(v.notices.map((n) => n.reason)).toEqual(["r2", "r3", "r4", "r5", "r6"]);
  });

  it("das Kopf-Abzeichen nennt Loop und Betriebsart; Störung vor Halt vor Pause", () => {
    const view = deriveLoopView([ev({ kind: "loop.info", mode: "dark", activity: "working" })]);
    expect(loopBadge("loop:aspark-factory", view)).toEqual({ text: "Loop · aspark-factory · dark", tone: "ok" });
    const paused = deriveLoopView([ev({ kind: "loop.info", mode: "dark" }), ev({ kind: "loop.command", command: "pause" })]);
    expect(loopBadge("loop:x", paused)).toMatchObject({ text: "Loop · x · dark · pausiert", tone: "warn" });
    const held = deriveLoopView([ev({ kind: "loop.hold", reason: "r" }), ev({ kind: "loop.command", command: "pause" })]);
    expect(loopBadge("loop:x", held).text).toContain("wartet auf dich");
    const bad = deriveLoopView([ev({ kind: "loop.hold", reason: "r" }), ev({ kind: "loop.broken", reason: "x" })]);
    expect(loopBadge("loop:x", bad)).toMatchObject({ text: "Loop · x · gestört", tone: "bad" });
  });
});
