import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { NormalizedEvent } from "../../src/shared/ws.ts";
import { currentStep, stepsOf, turnsOf, workSummary, type ChatItem, type Work } from "../../src/features/session/turns.ts";

/** Normalisierte Ströme aus den aufgezeichneten Adapter-Fixtures (scripts/turn-fixtures.ts). */
const FIXTURES = new URL("../fixtures/turns/", import.meta.url);
const fixture = (name: string): NormalizedEvent[] => JSON.parse(readFileSync(new URL(`${name}.json`, FIXTURES), "utf8")) as NormalizedEvent[];
const works = (items: ChatItem[]) => items.filter((i): i is Work => i.kind === "work");
const shown = (items: ChatItem[]) => items.flatMap((i) => (i.kind === "event" ? [i.event.seq] : []));

let seq = 0;
const ev = (type: string, payload: Record<string, unknown> = {}, summary = type): NormalizedEvent => {
  seq += 1;
  return { seq, ts: new Date(Date.parse("2026-11-11T08:00:00.000Z") + seq * 1000).toISOString(), sessionId: "s", type, summary, payload, blobRef: null };
};

describe("providerübergreifende Schritte", () => {
  it("erkennt Namen mit Namespace und ACP-Kategorien ohne den Originalnamen zu verlieren", () => {
    const work = works(turnsOf([
      ev("tool_use", { id: "a", name: "functions.exec_command", input: { cmd: "pwd" } }),
      ev("tool_result", { toolUseId: "a", content: "repo" }),
      ev("tool_use", { id: "b", name: "Datei README öffnen", kind: "read", input: { path: "README.md" } }),
    ], false))[0]!;
    expect(stepsOf(work).map((s) => [s.verb, s.kind, s.target])).toEqual([
      ["Führt aus", "run", "pwd"], ["Liest", "read", "README.md"],
    ]);
  });

  it("zeigt unbekannte Werkzeugnamen und verwaiste Ergebnisse mit geliefertem Namen", () => {
    const work = works(turnsOf([ev("tool_result", { toolUseId: "old", name: "custom_lookup", content: "Treffer" })], false))[0]!;
    expect(stepsOf(work)[0]).toMatchObject({ verb: "custom_lookup", state: "ok", short: "Treffer" });
  });

  it("verliert ausgelagertes Denken nicht vor dem Nachladen", () => {
    const thought = { ...ev("thinking", { truncated: true, bytes: 8000 }, "Langer Gedankengang"), blobRef: "sha256:abc" };
    expect(shown(turnsOf([thought], false))).toEqual([thought.seq]);
  });
});

describe("EPIC-P43 T43.4: Züge aus den aufgezeichneten Strömen aller Adapter", () => {
  const names = readdirSync(FIXTURES).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));

  it("liegt für jeden Adapter mit Mitschnitt vor", () => {
    expect(names.map((n) => n.split("-")[0]).sort()).toEqual(["claude", "codex", "copilot", "copilot", "opencode", "opencode", "pi"]);
  });

  for (const name of names) {
    it(`${name}: Auftrag → eine gefaltete Arbeit → Antwort; jeder Werkzeugaufruf ist ein Schritt mit Ergebnis`, () => {
      const events = fixture(name);
      const items = turnsOf(events, false);
      const [work, ...more] = works(items);
      expect(more).toHaveLength(0);
      expect(work!.running).toBe(false);
      // Jeder tool_use und jedes tool_result landet genau einmal in einem Schritt (nichts verloren).
      const steps = stepsOf(work!);
      const inSteps = steps.flatMap((s) => [s.use?.seq, s.result?.seq]).filter((n): n is number => n !== undefined);
      expect(inSteps.sort((a, b) => a - b)).toEqual(events.filter((e) => e.type === "tool_use" || e.type === "tool_result").map((e) => e.seq));
      for (const s of steps) {
        expect(s.state).not.toBe("running");
        expect(s.target, `${name}: Ziel von ${s.verb}`).not.toBe("");
      }
      // Erst der Auftrag, am Ende die Antwort des Agenten, offen im Chat.
      expect(items[0]).toMatchObject({ kind: "event", event: { type: "user" } });
      const last = items.at(-1)!;
      expect(last.kind === "event" && last.event.type === "assistant").toBe(true);
      // Systemereignisse stehen nicht im Chat (sie bleiben im Verlauf).
      expect(items.some((i) => i.kind === "event" && i.event.type === "system")).toBe(false);
    });
  }

  it("claude: Bash wird „Führt aus“ mit dem Befehl als Ziel und der Ausgabe als Kurzform", () => {
    const step = stepsOf(works(turnsOf(fixture("claude-tool-use"), false))[0]!)[0]!;
    expect(step).toMatchObject({ verb: "Führt aus", kind: "run", target: "echo hello-ancientvoid", state: "ok", short: "hello-ancientvoid" });
  });

  it("codex: der Befehl steht am Ereignis selbst; Text vor dem ersten Schritt bleibt offen davor", () => {
    const items = turnsOf(fixture("codex-tool-use"), false);
    expect(items.map((i) => (i.kind === "event" ? i.event.type : i.kind))).toEqual(["user", "assistant", "work", "assistant"]);
    expect(stepsOf(works(items)[0]!)[0]).toMatchObject({ verb: "Führt aus", target: "/usr/bin/bash -lc 'echo hello-ancientvoid'", state: "ok" });
  });

  it("opencode und copilot: ein fehlgeschlagener Lesevorgang ist ein Fehler-Schritt mit Grund", () => {
    for (const name of ["opencode-tool-error", "copilot-tool-error"]) {
      const work = works(turnsOf(fixture(name), false))[0]!;
      const step = stepsOf(work)[0]!;
      expect(step).toMatchObject({ verb: "Liest", kind: "read", state: "error" });
      expect(step.short).toMatch(/not found|does not exist/i);
      expect(workSummary(work)).toMatch(/^1 Schritt · 1 gelesen · 1 Fehler/);
    }
  });

  it("pi: Denken zwischen den Schritten faltet mit der Arbeit, Denken davor steht offen", () => {
    const items = turnsOf(fixture("pi-tool-use"), false);
    expect(items.map((i) => (i.kind === "event" ? i.event.type : i.kind))).toEqual(["user", "thinking", "work", "thinking", "assistant"]);
  });
});

describe("EPIC-P43 T43.4: Zug-Regeln", () => {
  it("eine laufende Arbeit bleibt offen; der letzte Schritt ohne Ergebnis ist der laufende", () => {
    const events = [ev("user", { kind: "session.prompt" }), ev("tool_use", { id: "a", name: "Read", input: { file_path: "src/a.ts" } }), ev("tool_result", { toolUseId: "a", content: "x" }), ev("assistant", { text: "jetzt die Tests" }), ev("tool_use", { id: "b", name: "Bash", input: { command: "npm test" } })];
    const work = works(turnsOf(events, true))[0]!;
    expect(work.running).toBe(true);
    expect(currentStep(work)?.target).toBe("npm test");
    // Zwischentext gehört zur Arbeit.
    expect(work.entries.map((e) => e.kind)).toEqual(["step", "note", "step"]);
    // Kommt der Strom ohne Zugende und die Session läuft nicht mehr: nichts läuft, nichts geht verloren.
    const closed = works(turnsOf(events, false))[0]!;
    expect(closed.running).toBe(false);
    expect(stepsOf(closed).map((s) => s.state)).toEqual(["ok", "open"]);
  });

  it("jeder Auftrag beginnt einen neuen Zug; Fortsetzen ebenso", () => {
    const events = [
      ev("user", { kind: "session.prompt" }),
      ev("tool_use", { id: "a", name: "Grep", input: { pattern: "TODO" } }),
      ev("tool_result", { toolUseId: "a", content: "3 Treffer" }),
      ev("system", { kind: "session.turn_end" }),
      ev("system", { kind: "session.resumed" }),
      ev("tool_use", { id: "b", name: "Edit", input: { file_path: "a.ts" } }),
    ];
    const items = turnsOf(events, true);
    const [first, second] = works(items);
    expect(first!.running).toBe(false);
    expect(second!.running).toBe(true);
    expect(stepsOf(first!)[0]!.verb).toBe("Sucht");
    expect(stepsOf(second!)[0]!.verb).toBe("Bearbeitet");
  });

  it("unbekannte Ereignistypen werden gezählt und als eine Zeile gezeigt (fail loud)", () => {
    const events = [ev("user", { kind: "session.prompt" }), ev("future_type"), ev("future_type"), ev("assistant", { text: "ok" }), ev("other_future")];
    const items = turnsOf(events, false);
    expect(items.filter((i) => i.kind === "unknown").map((i) => (i.kind === "unknown" ? i.count : 0))).toEqual([2, 1]);
  });

  it("Fehler und Anbieterfehler stehen offen, auch mitten in der Arbeit", () => {
    const events = [ev("user", { kind: "session.prompt" }), ev("tool_use", { id: "a", name: "Bash", input: { command: "ls" } }), ev("system", { kind: "provider.error", message: "rate limit" }), ev("error", { message: "kaputt" })];
    const items = turnsOf(events, false);
    expect(items.map((i) => (i.kind === "event" ? i.event.type : i.kind))).toEqual(["user", "work", "system", "error"]);
  });

  it("ein Ergebnis ohne passenden Aufruf wird ein eigener Schritt statt zu verschwinden", () => {
    const events = [ev("user", { kind: "session.prompt" }), ev("tool_result", { toolUseId: "fremd", isError: true, error: "Zeitüberschreitung" })];
    const step = stepsOf(works(turnsOf(events, false))[0]!)[0]!;
    expect(step).toMatchObject({ state: "error", short: "Zeitüberschreitung", use: null });
  });

  it("der Exit-Code zählt als Fehler; leere Denkblöcke erscheinen nicht", () => {
    const events = [ev("user", { kind: "session.prompt" }), ev("thinking", { text: "" }), ev("tool_use", { id: "a", command: "false" }), ev("tool_result", { toolUseId: "a", exitCode: 1, content: "" })];
    const items = turnsOf(events, false);
    expect(shown(items)).toEqual([events[0]!.seq]);
    expect(stepsOf(works(items)[0]!)[0]!.state).toBe("error");
  });

  it("die gefaltete Zeile zählt nach Art und nennt die Dauer", () => {
    const events = [
      ev("user", { kind: "session.prompt" }),
      ev("tool_use", { id: "1", name: "Read", input: { file_path: "a" } }),
      ev("tool_result", { toolUseId: "1", content: "x" }),
      ev("tool_use", { id: "2", name: "read", input: { path: "b" } }),
      ev("tool_result", { toolUseId: "2", content: "x" }),
      ev("tool_use", { id: "3", name: "Edit", input: { file_path: "a" } }),
      ev("tool_result", { toolUseId: "3", content: "x" }),
      ev("tool_use", { id: "4", name: "Bash", input: { command: "npm test" } }),
      ev("tool_result", { toolUseId: "4", content: "grün" }),
      ev("system", { kind: "session.turn_end" }),
    ];
    expect(workSummary(works(turnsOf(events, false))[0]!)).toBe("4 Schritte · 2 gelesen · 1 bearbeitet · 1 ausgeführt · 8 s");
  });
});
