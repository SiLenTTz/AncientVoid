import { describe, expect, it } from "vitest";
import { applyWindowMessage, parseWindowMessage, popoutUrl, pruneWindows, targetKey, WINDOW_TTL_MS, windowFor } from "../../../src/features/windows/protocol.ts";

const session = { kind: "session", sessionId: "s1" } as const;
const remote = { kind: "session", sessionId: "s2", hostId: "h2" } as const;
const tool = { kind: "tool", page: "status" } as const;

describe("Fensterprotokoll (EPIC-P34 T34.10)", () => {
  it("die URL nutzt die vorhandene Hash-Route und trägt nie ein Token", () => {
    expect(popoutUrl(session)).toBe("/?window=1#/sessions/s1");
    expect(popoutUrl(remote)).toBe("/?window=1#/hosts/h2/sessions/s2");
    expect(popoutUrl(tool)).toBe("/?window=1#/status");
    for (const t of [session, remote, tool]) expect(popoutUrl(t)).not.toMatch(/token/i);
  });

  it("targetKey unterscheidet Host, Session und Werkzeug", () => {
    expect(new Set([targetKey(session), targetKey(remote), targetKey(tool)]).size).toBe(3);
    expect(targetKey({ kind: "session", sessionId: "s1" })).toBe(targetKey(session));
  });

  it("parseWindowMessage nimmt nur gültige Nachrichten an", () => {
    expect(parseWindowMessage({ type: "hello", id: "w1", target: session })).toEqual({ type: "hello", id: "w1", target: session });
    expect(parseWindowMessage({ type: "heartbeat", id: "w1" })).toEqual({ type: "heartbeat", id: "w1" });
    expect(parseWindowMessage({ type: "ping" })).toEqual({ type: "ping" });
    for (const bad of [null, "x", {}, { type: "hello" }, { type: "hello", id: "w", target: { kind: "tool", page: "dashboard" } }, { type: "hello", id: "", target: session }, { type: "unbekannt", id: "w" }, { type: "return", id: "w1" }]) {
      expect(parseWindowMessage(bad)).toBeNull();
    }
  });

  it("hello trägt ein, heartbeat hält am Leben, bye und return entfernen", () => {
    let reg = applyWindowMessage({}, { type: "hello", id: "w1", target: session }, 1000);
    expect(windowFor(reg, session)).toMatchObject({ id: "w1" });
    reg = applyWindowMessage(reg, { type: "heartbeat", id: "w1" }, 5000);
    expect(reg.w1!.lastSeen).toBe(5000);
    expect(applyWindowMessage(reg, { type: "bye", id: "w1" }, 6000)).toEqual({});
    expect(applyWindowMessage(reg, { type: "return", id: "w1", target: session }, 6000)).toEqual({});
  });

  it("ein heartbeat ohne hello ist unbekannt und wird ignoriert (kein Phantomfenster)", () => {
    expect(applyWindowMessage({}, { type: "heartbeat", id: "x" }, 1)).toEqual({});
  });

  it("Fenster ohne Lebenszeichen fallen nach der TTL heraus", () => {
    const reg = applyWindowMessage(applyWindowMessage({}, { type: "hello", id: "a", target: session }, 0), { type: "hello", id: "b", target: tool }, WINDOW_TTL_MS);
    expect(Object.keys(pruneWindows(reg, WINDOW_TTL_MS + 1))).toEqual(["b"]);
    expect(Object.keys(pruneWindows(reg, WINDOW_TTL_MS))).toEqual(["a", "b"]);
  });

  it("ein zweites hello für dasselbe Ziel ersetzt das alte Fenster (Reload eines Fensters)", () => {
    let reg = applyWindowMessage({}, { type: "hello", id: "alt", target: session }, 0);
    reg = applyWindowMessage(reg, { type: "hello", id: "neu", target: session }, 10);
    expect(windowFor(reg, session)).toMatchObject({ id: "neu" });
    expect(Object.keys(reg)).toEqual(["neu"]);
  });
});
