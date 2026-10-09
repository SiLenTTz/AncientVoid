import { describe, expect, it } from "vitest";
import { ClaudeLive, parseClaudeAgents } from "../../../src/modules/discovery/claude-live.ts";

const SAMPLE = JSON.stringify([
  { id: "2772f2e5", cwd: "/p/hiveos", kind: "background", startedAt: 1, sessionId: "2772f2e5-aaaa", name: "HiveOS Design", state: "blocked" },
  { pid: 1702379, cwd: "/p/securesight", kind: "interactive", startedAt: 2, sessionId: "1619abc2-bbbb", name: "securesight-harnez-d5", status: "idle" },
  { pid: 5, cwd: "/p/x", kind: "interactive", sessionId: "" }, // ohne Session-ID: übersprungen
]);

describe("EPIC-P15 T15.4 claude agents --json", () => {
  it("liest Name, Art, PID und Zustand; Zeilen ohne Session-ID fallen weg", () => {
    expect(parseClaudeAgents(SAMPLE)).toEqual([
      { sessionId: "2772f2e5-aaaa", kind: "background", name: "HiveOS Design", cwd: "/p/hiveos", pid: null, state: "blocked" },
      { sessionId: "1619abc2-bbbb", kind: "interactive", name: "securesight-harnez-d5", cwd: "/p/securesight", pid: 1702379, state: "idle" },
    ]);
  });

  it("eine Nicht-Liste ist ein Fehler, kein stilles Leer", () => {
    expect(() => parseClaudeAgents("{}")).toThrow("keine Liste");
  });

  it("find liefert die offene Session, sonst null; ein Aufruf bedient mehrere Abfragen (Cache)", async () => {
    let calls = 0;
    const live = new ClaudeLive("claude", async () => (calls++, SAMPLE));
    expect((await live.find("1619abc2-bbbb"))?.name).toBe("securesight-harnez-d5");
    expect(await live.find("gibt-es-nicht")).toBeNull();
    expect(calls).toBe(1);
  });

  it("eine CLI ohne `agents` oder ein Fehler gibt eine leere Liste und merkt sich den Grund", async () => {
    const live = new ClaudeLive("claude", async () => {
      throw new Error("unknown command 'agents'");
    });
    expect(await live.list()).toEqual([]);
    expect(live.lastError).toContain("unknown command");
  });

  it("nach Ablauf der Gültigkeit wird neu gelesen", async () => {
    let calls = 0;
    const live = new ClaudeLive("claude", async () => (calls++, "[]"), 0);
    await live.list();
    await live.list();
    expect(calls).toBe(2);
  });

  it("BUG-0049: ein einzelner Fehlschlag behält die letzte gute Liste statt sie zu leeren", async () => {
    let fail = false;
    const live = new ClaudeLive("claude", async () => {
      if (fail) throw new Error("timeout");
      return SAMPLE;
    }, 0);
    expect((await live.list()).map((s) => s.name)).toEqual(["HiveOS Design", "securesight-harnez-d5"]);
    fail = true;
    expect((await live.list()).map((s) => s.name)).toEqual(["HiveOS Design", "securesight-harnez-d5"]); // behalten
    expect(live.lastError).toContain("timeout");
    fail = false;
    expect(await live.list()).toHaveLength(2);
    expect(live.lastError).toBeNull();
  });
});
