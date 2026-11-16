import { describe, expect, it } from "vitest";
import { DesktopService, HubDatabase } from "../../../src/index.ts";

/** EPIC-P11 (ADR-0031): the hub's queue for the desktop companion. */
describe("desktop service (T11.2)", () => {
  const focus = { id: "0xabc", app: "foot", title: "~/AncientVoid", revision: 7 };
  const state = (over: Record<string, unknown> = {}) => ({ backend: "sway", focus, locked: false, paused: false, blocked: null, version: "0.1.0", ...over });

  function setup(now = { t: Date.parse("2026-09-24T10:00:00Z") }) {
    const db = new HubDatabase(":memory:");
    const d = new DesktopService(db, { now: () => now.t, pickupMs: 10_000, reportMs: 60_000, onlineMs: 15_000 });
    return { db, d, now };
  }

  it("a request for the window the person saw is delivered once, with its text; the text is dropped afterwards", async () => {
    const { d, db } = setup();
    d.report("workstation", state());
    const a = d.request({ companion: "workstation", kind: "insert", text: "Hallo PC", target: { id: "0xabc", revision: 7 } }, "pixel");
    expect(a).toMatchObject({ status: "pending", textLength: 8, target: { app: "foot", title: "~/AncientVoid" } });
    const first = await d.next("workstation", 0);
    expect(first.actions).toHaveLength(1);
    expect(first.actions[0]).toMatchObject({ id: a.id, text: "Hallo PC", status: "delivered" });
    expect((await d.next("workstation", 0)).actions).toHaveLength(0); // never twice
    d.result("workstation", a.id, { status: "done", detail: "8 Zeichen", typedChars: 8 });
    expect(d.get(a.id)).toMatchObject({ status: "done", typedChars: 8 });
    expect((db.prepare("SELECT text FROM desktop_actions WHERE id = ?").get(a.id) as { text: string | null }).text).toBeNull();
    // Another companion can't report for it; a final state stays final.
    expect(d.result("other", a.id, { status: "failed", detail: null, typedChars: 0 })).toMatchObject({ status: "done" });
  });

  it("targeted paste is explicit, Hyprland-only, and recorded with the action", () => {
    const { d } = setup();
    d.report("workstation", state());
    expect(() => d.request({ companion: "workstation", kind: "insert", inputMode: "targeted-paste", text: "x", target: { id: "0xabc", revision: 7 } }, "pixel"))
      .toThrow(/nur auf Hyprland/);
    d.report("workstation", state({ backend: "hyprland" }));
    const a = d.request({ companion: "workstation", kind: "insert", inputMode: "targeted-paste", text: "x", target: { id: "0xabc", revision: 7 } }, "pixel");
    expect(a.inputMode).toBe("targeted-paste");
    expect(d.request({ companion: "workstation", kind: "insert", text: "y", target: { id: "0xabc", revision: 7 } }, "pixel").inputMode).toBe("keystroke");
  });

  it("reads pre-T12.12 persisted actions as keystroke actions", () => {
    const { d, db } = setup();
    d.report("workstation", state());
    const a = d.request({ companion: "workstation", kind: "insert", text: "old", target: { id: "0xabc", revision: 7 } }, "pixel");
    const oldRecord: Record<string, unknown> = { ...a };
    delete oldRecord.inputMode;
    db.prepare("UPDATE desktop_actions SET state = ? WHERE id = ?").run(JSON.stringify(oldRecord), a.id);
    expect(d.get(a.id)?.inputMode).toBe("keystroke");
    expect(d.list()[0]?.inputMode).toBe("keystroke");
  });

  it("the long poll wakes as soon as a request arrives", async () => {
    const { d } = setup();
    d.report("workstation", state());
    const waiting = d.next("workstation", 20_000);
    const a = d.request({ companion: "workstation", kind: "key", key: "Return", target: { id: "0xabc", revision: 7 } }, "pixel");
    const got = await waiting;
    expect(got.actions.map((x) => x.id)).toEqual([a.id]);
  });

  it("refuses in words: focus moved since the preview, offline, stopped, locked, password window", () => {
    const { d, now } = setup();
    expect(() => d.request({ companion: "workstation", kind: "insert", text: "x", target: { id: "0xabc", revision: 7 } }, "p")).toThrow(/nicht verbunden/);
    d.report("workstation", state());
    expect(() => d.request({ companion: "workstation", kind: "insert", text: "x", target: { id: "0xabc", revision: 6 } }, "p")).toThrow(/Fokus am PC hat sich geändert \(jetzt: foot/);
    expect(() => d.request({ companion: "workstation", kind: "insert", text: "x", target: { id: "0xdef", revision: 7 } }, "p")).toThrow(/Fokus/);
    d.report("workstation", state({ paused: true }));
    expect(() => d.request({ companion: "workstation", kind: "insert", text: "x", target: { id: "0xabc", revision: 7 } }, "p")).toThrow(/Not-Stopp/);
    d.report("workstation", state({ locked: true }));
    expect(() => d.request({ companion: "workstation", kind: "insert", text: "x", target: { id: "0xabc", revision: 7 } }, "p")).toThrow(/gesperrt/);
    d.report("workstation", state({ focus: { ...focus, app: "org.keepassxc.KeePassXC" } }));
    expect(d.companions()[0]!.blocked).toMatch(/Passwort/);
    expect(() => d.request({ companion: "workstation", kind: "insert", text: "x", target: { id: "0xabc", revision: 7 } }, "p")).toThrow(/Passwort/);
    d.report("workstation", state({ focus: { ...focus, title: "Authentication Required — Password for dev" } }));
    expect(() => d.request({ companion: "workstation", kind: "insert", text: "x", target: { id: "0xabc", revision: 7 } }, "p")).toThrow(/Passwort/);
    d.report("workstation", state({ focus: { ...focus, title: "login.ts — AncientVoid — Code" } }));
    expect(d.companions()[0]!.blocked).toBeNull(); // an editor with login.ts is not a login prompt
    now.t += 16_000;
    expect(d.companions()[0]!.online).toBe(false);
    expect(() => d.request({ companion: "workstation", kind: "insert", text: "x", target: { id: "0xabc", revision: 7 } }, "p")).toThrow(/offline/);
  });

  it("stale requests expire; delivered ones without a report become uncertain — never run again", async () => {
    const { d, now } = setup();
    d.report("workstation", state());
    const stale = d.request({ companion: "workstation", kind: "insert", text: "alt", target: { id: "0xabc", revision: 7 } }, "p");
    now.t += 11_000;
    d.report("workstation", state());
    expect((await d.next("workstation", 0)).actions).toHaveLength(0);
    expect(d.get(stale.id)).toMatchObject({ status: "expired" });
    const b = d.request({ companion: "workstation", kind: "insert", text: "neu", target: { id: "0xabc", revision: 7 } }, "p");
    await d.next("workstation", 0);
    now.t += 61_000;
    expect(d.list().find((x) => x.id === b.id)).toMatchObject({ status: "uncertain" });
  });

  it("a hub restart: pending expires, delivered becomes uncertain — nothing is replayed (AC-P11-5)", async () => {
    const { d, db, now } = setup();
    d.report("workstation", state());
    const delivered = d.request({ companion: "workstation", kind: "insert", text: "eins", target: { id: "0xabc", revision: 7 } }, "p");
    await d.next("workstation", 0);
    const pending = d.request({ companion: "workstation", kind: "insert", text: "zwei", target: { id: "0xabc", revision: 7 } }, "p");
    const again = new DesktopService(db, { now: () => now.t });
    expect(again.get(delivered.id)).toMatchObject({ status: "uncertain" });
    expect(again.get(pending.id)).toMatchObject({ status: "expired" });
    again.report("workstation", state());
    expect((await again.next("workstation", 0)).actions).toHaveLength(0);
  });

  it("cancel: before pickup at once; after pickup the companion is told", async () => {
    const { d } = setup();
    d.report("workstation", state());
    const a = d.request({ companion: "workstation", kind: "insert", text: "x", target: { id: "0xabc", revision: 7 } }, "p");
    expect(d.cancel(a.id)).toMatchObject({ status: "cancelled" });
    const b = d.request({ companion: "workstation", kind: "insert", text: "lang", target: { id: "0xabc", revision: 7 } }, "p");
    await d.next("workstation", 0);
    d.cancel(b.id);
    expect((await d.next("workstation", 0)).cancel).toEqual([b.id]);
  });
});
