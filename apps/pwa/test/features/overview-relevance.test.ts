import { describe, expect, it } from "vitest";
import type { ApprovalRequest, SessionRecord } from "../../src/shared/api.ts";
import { compareByActivity, lastActivityAt } from "../../src/features/overview/session-list.ts";
import { compareQueue, decidableOnCard, pendingFor, quietOpen, sectionOf } from "../../src/features/overview/queue.ts";

const NOW = Date.parse("2026-10-09T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const session = (over: Partial<SessionRecord>): SessionRecord =>
  ({ id: "s", status: "idle", updatedAt: ago(0), lastActivity: null, pinned: false, ...over }) as SessionRecord;

describe("EPIC-P43 T43.3: der Start als Warteschlange", () => {
  it("läuft etwas, steht es unter „Arbeitet“ — egal wie lange schon", () => {
    expect(sectionOf(session({ status: "working", lastActivity: { text: "x", type: "tool_use", at: ago(48 * 3600_000) } }))).toBe("aktiv");
    expect(sectionOf(session({ status: "starting" }))).toBe("aktiv");
  });

  it("ein beendeter Zug ruft nur, solange ihn hier niemand gesehen hat", () => {
    expect(sectionOf(session({ status: "idle" }), true)).toBe("braucht");
    expect(sectionOf(session({ status: "idle" }), false)).toBe("zuletzt");
    // Beendet oder pausiert ist ruhig, auch mit ungelesenen Ereignissen.
    expect(sectionOf(session({ status: "stopped" }), true)).toBe("zuletzt");
    expect(sectionOf(session({ status: "parked" }), true)).toBe("zuletzt");
  });

  it("Freigabe, Fehler und Unterbrechung sind „Du bist dran“ — auch angeheftet und alt", () => {
    const old = { lastActivity: { text: "x", type: "assistant", at: ago(10 * 24 * 3600_000) } };
    expect(sectionOf(session({ ...old, status: "waiting_approval", pinned: true }))).toBe("braucht");
    expect(sectionOf(session({ ...old, status: "error" }))).toBe("braucht");
    expect(sectionOf(session({ ...old, status: "interrupted" }))).toBe("braucht");
    // Fail loud: ein unbekannter Status ist nie „ruhig“.
    expect(sectionOf(session({ status: "future_status" }))).toBe("braucht");
  });

  it("Angeheftetes bleibt offen sichtbar, solange es ruhig ist", () => {
    expect(sectionOf(session({ pinned: true }))).toBe("pins");
    expect(sectionOf(session({ pinned: true, status: "working" }))).toBe("aktiv");
  });

  it("„Du bist dran“: was zuerst abläuft, steht oben; danach das, was am längsten wartet", () => {
    const a = session({ id: "a", lastActivity: { text: "x", type: "assistant", at: ago(60_000) } });
    const b = session({ id: "b", lastActivity: { text: "x", type: "assistant", at: ago(3600_000) } });
    const c = session({ id: "c", lastActivity: { text: "x", type: "assistant", at: ago(10_000) } });
    const d = session({ id: "d", lastActivity: { text: "x", type: "assistant", at: ago(5_000) } });
    const deadline: Record<string, string> = { c: ago(-300_000), d: ago(-30_000) };
    expect([a, b, c, d].sort(compareQueue((s) => deadline[s.id] ?? null)).map((s) => s.id)).toEqual(["d", "c", "b", "a"]);
  });

  it("auf der Karte entscheidbar ist nur, was ein Tipp entscheidet", () => {
    const req = (over: Partial<ApprovalRequest>): ApprovalRequest => ({ id: "r", sessionId: "s", class: "write", status: "pending", reasonRequired: false, timeoutAt: ago(-60_000), ...over }) as ApprovalRequest;
    expect(decidableOnCard(req({}))).toBe(true);
    expect(decidableOnCard(req({ tool: { name: "Bash", input: "{}" } }))).toBe(true);
    expect(decidableOnCard(req({ class: "destructive" }))).toBe(false);
    expect(decidableOnCard(req({ reasonRequired: true }))).toBe(false);
    expect(decidableOnCard(req({ tool: { name: "AskUserQuestion", input: "{}", questions: [{ question: "?", options: [], multiSelect: false }] } }))).toBe(false);
    expect(decidableOnCard(req({ status: "approved" }))).toBe(false);
  });

  it("von mehreren offenen Anfragen einer Session zählt die, die zuerst abläuft", () => {
    const req = (id: string, sessionId: string, timeoutAt: string): ApprovalRequest => ({ id, sessionId, status: "pending", timeoutAt }) as ApprovalRequest;
    const all = [req("late", "s", ago(-600_000)), req("soon", "s", ago(-10_000)), req("other", "t", ago(-1_000))];
    expect(pendingFor(all, "s")?.id).toBe("soon");
    expect(pendingFor(all, "x")).toBeNull();
  });

  it("„Ruhig“ ist zu, solange oben etwas steht; Suche und eigene Wahl gehen vor", () => {
    const some = { braucht: 1, aktiv: 0, pins: 0, zuletzt: 5 };
    const none = { braucht: 0, aktiv: 0, pins: 0, zuletzt: 5 };
    expect(quietOpen(null, some, false)).toBe(false);
    expect(quietOpen(null, none, false)).toBe(true);
    expect(quietOpen(true, some, false)).toBe(true);
    expect(quietOpen(false, none, false)).toBe(false);
    expect(quietOpen(false, some, true)).toBe(true);
  });

  it("sortiert nach letzter Aktivität; updatedAt (Archivieren, Modus) schiebt nichts nach oben", () => {
    const touched = session({ id: "a", updatedAt: ago(0), lastActivity: { text: "x", type: "assistant", at: ago(5 * 3600_000) } });
    const recent = session({ id: "b", updatedAt: ago(3600_000), lastActivity: { text: "x", type: "assistant", at: ago(3600_000) } });
    const noActivity = session({ id: "c", updatedAt: ago(10 * 3600_000), lastActivity: null });
    expect([touched, noActivity, recent].sort(compareByActivity).map((s) => s.id)).toEqual(["b", "a", "c"]);
    expect(lastActivityAt(noActivity)).toBe(noActivity.updatedAt);
  });
});
