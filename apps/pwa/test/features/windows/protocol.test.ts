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

  it("EPIC-P39 T39.3: das Browser-Fenster hat eine eigene Route, einen eigenen Schlüssel und trägt nie ein Token", () => {
    const browser = { kind: "browser", sessionId: "s1" } as const;
    const browserRemote = { kind: "browser", sessionId: "s2", hostId: "h2" } as const;
    expect(popoutUrl(browser)).toBe("/?window=1#/sessions/s1/browser");
    expect(popoutUrl(browserRemote)).toBe("/?window=1#/hosts/h2/sessions/s2/browser");
    for (const t of [browser, browserRemote]) expect(popoutUrl(t)).not.toMatch(/token/i);
    // Session-Fenster und Browser-Fenster derselben Session sind verschiedene Ziele.
    expect(new Set([targetKey(session), targetKey(browser), targetKey(browserRemote)]).size).toBe(3);
    expect(parseWindowMessage({ type: "hello", id: "w9", target: browser })).toEqual({ type: "hello", id: "w9", target: browser });
    expect(parseWindowMessage({ type: "hello", id: "w9", target: browserRemote })).toEqual({ type: "hello", id: "w9", target: browserRemote });
    expect(parseWindowMessage({ type: "hello", id: "w9", target: { kind: "browser" } })).toBeNull();
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

describe("Herauslösen überall (EPIC-P43 T43.7, ADR-0068)", () => {
  const changes = { kind: "changes", sessionId: "s1" } as const;
  const remoteReport = { kind: "report", sessionId: "s2", hostId: "h2" } as const;

  it("Ansichten tragen die Art im Query, die Hash-Route bleibt die der Session", () => {
    expect(popoutUrl(changes)).toBe("/?window=1&view=changes#/sessions/s1");
    expect(popoutUrl(remoteReport)).toBe("/?window=1&view=report#/hosts/h2/sessions/s2");
    expect(popoutUrl({ kind: "queue" })).toBe("/?window=1&view=queue#/");
    expect(popoutUrl({ kind: "nyx" })).toBe("/?window=1&view=nyx#/");
  });

  it("je Ansicht und Session ein eigener Schlüssel — getrennt von der Session selbst", () => {
    const keys = new Set([targetKey(session), targetKey(changes), targetKey({ kind: "files", sessionId: "s1" }), targetKey({ ...changes, hostId: "h2" }), targetKey({ kind: "queue" }), targetKey({ kind: "nyx" })]);
    expect(keys.size).toBe(6);
  });

  it("parseWindowMessage nimmt Ansichtsziele und recall an, Unbekanntes nicht", () => {
    expect(parseWindowMessage({ type: "hello", id: "w", target: changes })).toEqual({ type: "hello", id: "w", target: changes });
    expect(parseWindowMessage({ type: "hello", id: "w", target: { kind: "queue" } })).toEqual({ type: "hello", id: "w", target: { kind: "queue" } });
    expect(parseWindowMessage({ type: "hello", id: "w", target: { kind: "changes" } })).toBeNull();
    expect(parseWindowMessage({ type: "hello", id: "w", target: { kind: "kaputt", sessionId: "s1" } })).toBeNull();
    expect(parseWindowMessage({ type: "recall", id: "w" })).toEqual({ type: "recall", id: "w" });
    expect(parseWindowMessage({ type: "recall" })).toBeNull();
  });

  it("recall ändert das Register nicht — erst das return des Fensters trägt aus", () => {
    const reg = applyWindowMessage({}, { type: "hello", id: "w", target: changes }, 1);
    expect(applyWindowMessage(reg, { type: "recall", id: "w" }, 2)).toBe(reg);
    expect(windowFor(applyWindowMessage(reg, { type: "return", id: "w", target: changes }, 3), changes)).toBeNull();
  });
});

describe("Dateibaum-Fenster (BUG-0128)", () => {
  const filetree = { kind: "filetree" } as const;

  it("genau ein Ziel für die gebündelte Seitenleiste — nie Einzeldatei-Fenster", () => {
    expect(popoutUrl(filetree)).toBe("/?window=1#/dateibaum");
    expect(targetKey(filetree)).toBe("filetree");
    expect(targetKey({ kind: "filetree" })).not.toBe(targetKey({ kind: "files", sessionId: "s1" }));
    expect(parseWindowMessage({ type: "hello", id: "w9", target: filetree })).toEqual({ type: "hello", id: "w9", target: filetree });
  });
});
