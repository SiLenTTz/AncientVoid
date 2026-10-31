import { describe, expect, it } from "vitest";
import { inQuietHours, pushHostAllowed, type HubNotification } from "@ancientvoid/contracts";
import { HubDatabase, PushService, SettingsStore, type PushSender } from "../../../src/index.ts";

const sub = (endpoint = "https://fcm.googleapis.com/fcm/send/abc") => ({ endpoint, keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" } });
const note = (id: number, kind: string): HubNotification => ({ id, sessionId: "s1", level: "warning", title: "Freigabe nötig", detail: "rm -rf dist", kind, createdAt: "x" });

function setup(opts: { status?: number; now?: Date } = {}) {
  const db = new HubDatabase(":memory:");
  const sent: { endpoint: string; payload: string }[] = [];
  const sender: PushSender = async (s, payload) => {
    sent.push({ endpoint: s.endpoint, payload });
    return { statusCode: opts.status ?? 201 };
  };
  const push = new PushService(db, new SettingsStore(db), { sender, hostId: "omarchy", ...(opts.now ? { now: () => opts.now! } : {}) });
  return { db, push, sent };
}

describe("Web Push (T8.3, ADR-0026)", () => {
  it("off by default — nothing leaves the hub; turning it on makes a VAPID key", async () => {
    const { push, sent } = setup();
    expect(push.enabled()).toBe(false);
    expect(push.subscribe(sub(), "pixel")).toMatchObject({ ok: false });
    expect(await push.notify(note(1, "tool.permission_requested"))).toBe(0);
    push.setEnabled(true);
    expect(push.publicKey()).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    expect(sent).toHaveLength(0);
  });

  it("only known push services — no requests to internal addresses", () => {
    const { push } = setup();
    push.setEnabled(true);
    for (const bad of ["http://fcm.googleapis.com/x", "https://127.0.0.1/x", "https://evil.example/x", "https://fcm.googleapis.com.evil.example/x"]) expect(push.subscribe(sub(bad), "pixel"), bad).toMatchObject({ ok: false });
    expect(pushHostAllowed("https://db5p.notify.windows.com/w/?token=1")).toBe(true);
    expect(push.subscribe(sub(), "pixel")).toEqual({ ok: true });
  });

  it("one push per notification and device, payload opaque; turn ends only when asked", async () => {
    const { push, sent } = setup();
    push.setEnabled(true);
    push.subscribe(sub(), "pixel");
    expect(await push.notify(note(1, "tool.permission_requested"))).toBe(1);
    expect(await push.notify(note(1, "tool.permission_requested"))).toBe(0);
    expect(JSON.parse(sent[0]!.payload)).toEqual({ id: 1, category: "approval", sessionId: "s1", hostId: "omarchy" });
    expect(sent[0]!.payload).not.toContain("rm -rf");
    expect(await push.notify(note(2, "session.turn_end"))).toBe(0);
    expect(await push.notify(note(3, "session.applied"))).toBe(0);
    push.subscribe({ ...sub(), done: true }, "pixel");
    expect(await push.notify(note(4, "session.turn_end"))).toBe(1);
    expect(push.list("pixel")[0]).toMatchObject({ service: "fcm.googleapis.com", mine: true, lastError: null });
    expect(push.list("pixel")[0]!.lastOkAt).not.toBeNull();
  });

  it("quiet hours hold pushes; the inbox keeps them", async () => {
    const at = new Date("2026-09-24T21:30:00Z"); // 23:30 in CEST
    const { push, sent } = setup({ now: at });
    push.setEnabled(true);
    push.subscribe({ ...sub(), quiet: { from: 22 * 60, to: 7 * 60, tzOffsetMinutes: -120 } }, "pixel");
    expect(await push.notify(note(5, "provider.error"))).toBe(0);
    expect(sent).toHaveLength(0);
    expect(inQuietHours({ from: 22 * 60, to: 7 * 60, tzOffsetMinutes: -120 }, new Date("2026-09-24T08:00:00Z"))).toBe(false);
    expect(inQuietHours({ from: 13 * 60, to: 14 * 60, tzOffsetMinutes: 0 }, new Date("2026-09-24T13:30:00Z"))).toBe(true);
  });

  it("a gone subscription (410) is marked, visible, and not used again", async () => {
    const { push, sent } = setup({ status: 410 });
    push.setEnabled(true);
    push.subscribe(sub(), "pixel");
    expect(await push.notify(note(6, "provider.error"))).toBe(0);
    expect(push.list(null)[0]).toMatchObject({ gone: true, lastError: expect.stringContaining("Abo erloschen") });
    await push.notify(note(7, "provider.error"));
    expect(sent).toHaveLength(1);
  });

  it("a rotated subscription replaces the old one", () => {
    const { push } = setup();
    push.setEnabled(true);
    push.subscribe(sub("https://fcm.googleapis.com/fcm/send/old"), "pixel");
    push.subscribe({ ...sub("https://fcm.googleapis.com/fcm/send/new"), oldEndpoint: "https://fcm.googleapis.com/fcm/send/old" }, "pixel");
    expect(push.list("pixel")).toHaveLength(1);
  });
});
