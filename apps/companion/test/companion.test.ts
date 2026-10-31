import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterRegistry, DesktopService, EventStore, HubDatabase, SessionManager, TokenService } from "@ancientvoid/core";
import { ProcessRunner } from "@ancientvoid/workers";
import type { FastifyInstance } from "fastify";
import { createHubApp } from "../../hub/src/app.ts";
import { Companion, HyprlandBackend, HyprlandInput, SwayBackend, WtypeInput, type FocusBackend, type FocusInfo, type InputBackend } from "../src/companion.ts";
import { sendControl, serveControl } from "../src/control.ts";

/** A desktop whose focus the test moves, and a keyboard that records. */
class FakeDesktop implements FocusBackend, InputBackend {
  readonly name = "fake";
  current: FocusInfo | null = { id: "w1", app: "foot", title: "Terminal", pid: 11 };
  isLocked = false;
  typed = "";
  keys: string[] = [];
  /** Like wtype -d: one key after another, killable at any point. */
  keyDelayMs = 0;
  onChunk: ((typed: string) => void) | null = null;
  async focus() {
    return this.current;
  }
  async locked() {
    return this.isLocked;
  }
  async type(text: string, signal: AbortSignal) {
    for (const ch of text) {
      if (this.keyDelayMs) await new Promise((r) => setTimeout(r, this.keyDelayMs));
      if (signal.aborted) throw new Error("aborted");
      this.typed += ch;
      this.onChunk?.(this.typed);
    }
  }
  async key(key: string) {
    this.keys.push(key);
  }
  async selectAll() {
    this.keys.push("ctrl+a");
  }
}

describe("desktop companion against a real hub (T11.2/T11.3/T11.5)", () => {
  let dir: string;
  let app: FastifyInstance;
  let sessions: SessionManager;
  let tokens: TokenService;
  let hub: string;
  let human: string;
  let companionToken: string;
  let desk: FakeDesktop;
  let companion: Companion;
  let running: Promise<void>;

  const api = async (path: string, token: string, body?: unknown) => {
    const res = await fetch(`${hub}${path}`, { method: body === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> & { companions?: { name: string; focus: { id: string; revision: number } | null; paused: boolean }[] } };
  };
  /** The preview: what the person sees — waits until the hub knows `want`. */
  const target = async (want = desk.current?.id) => {
    for (let i = 0; i < 50; i++) {
      const c = (await api("/api/desktop", human)).body.companions?.[0];
      if (c?.focus && c.focus.id === want) return { companion: c.name, target: { id: c.focus.id, revision: c.focus.revision } };
      await new Promise((r) => setTimeout(r, 30));
    }
    throw new Error("companion never reported");
  };
  const until = async (id: string, done: (s: string) => boolean) => {
    for (let i = 0; i < 200; i++) {
      const a = (await api(`/api/desktop/actions/${id}`, human)).body as { status: string; detail: string; typedChars: number };
      if (done(a.status)) return a;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error("action never finished");
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-companion-"));
    const db = new HubDatabase(":memory:");
    tokens = new TokenService(db);
    const registry = new AdapterRegistry();
    sessions = new SessionManager(db, new EventStore(join(dir, ".data")), registry, new ProcessRunner());
    app = await createHubApp({ sessions, tokens, registry, auth: { tokens, enforceTailnetIdentity: false }, desktop: new DesktopService(db) });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const addr = app.server.address() as { port: number };
    hub = `http://127.0.0.1:${addr.port}`;
    human = tokens.issue("pixel").token;
    companionToken = tokens.issue("companion:omarchy").token;
    desk = new FakeDesktop();
    companion = new Companion({ hub, token: companionToken, focus: desk, input: desk, focusMs: 20, watchMs: 10 });
    running = companion.run();
  });

  afterEach(async () => {
    companion.shutdown();
    await app.close();
    await running.catch(() => undefined);
    await sessions.shutdown();
    await rm(dir, { recursive: true, force: true });
  });

  it("the person sees the focused window, sends text; the companion types it once into exactly that window", async () => {
    const t = await target();
    const c = (await api("/api/desktop", human)).body.companions![0]!;
    expect(c).toMatchObject({ name: "omarchy", focus: { app: "foot", title: "Terminal" }, online: true });
    const req = await api("/api/desktop/actions", human, { ...t, kind: "insert", text: "git status && npm test äöü" });
    expect(req.status).toBe(201);
    const done = await until(String(req.body.id), (s) => s === "done");
    expect(done.typedChars).toBe(26);
    expect(desk.typed).toBe("git status && npm test äöü");
    const key = await api("/api/desktop/actions", human, { ...(await target()), kind: "key", key: "Return" });
    await until(String(key.body.id), (s) => s === "done");
    expect(desk.keys).toEqual(["Return"]);
    const replace = await api("/api/desktop/actions", human, { ...(await target()), kind: "replace", text: "neu" });
    await until(String(replace.body.id), (s) => s === "done");
    expect(desk.keys).toEqual(["Return", "ctrl+a"]);
  });

  it("focus moves after the preview → refused, nothing typed; focus moves while typing → stops at once (AC-P11-1)", async () => {
    const t = await target("w1");
    desk.current = { id: "w2", app: "org.telegram.desktop", title: "Chat", pid: 12 };
    const moved = await api("/api/desktop/actions", human, { ...t, kind: "insert", text: "geheim" });
    // Either the hub already saw the new focus (409) or the companion refuses.
    if (moved.status === 201) expect((await until(String(moved.body.id), (s) => s !== "pending" && s !== "delivered")).status).toBe("refused");
    else expect(moved.status).toBe(409);
    expect(desk.typed).toBe("");

    desk.current = { id: "w1", app: "foot", title: "Terminal", pid: 11 };
    const t2 = await target();
    desk.keyDelayMs = 4;
    desk.onChunk = (typed) => {
      if (typed.length >= 16) desk.current = { id: "w2", app: "org.telegram.desktop", title: "Chat", pid: 12 };
    };
    const req = await api("/api/desktop/actions", human, { ...t2, kind: "insert", text: "a".repeat(80) });
    const out = await until(String(req.body.id), (s) => s === "failed" || s === "done");
    expect(out.status).toBe("failed");
    expect(out.detail).toMatch(/Fokus hat sich beim Tippen geändert/);
    // Leak bound: watch interval ÷ key delay (+ a poll) — a few keys at most.
    expect(desk.typed.length - 16).toBeLessThanOrEqual(8);
    expect(Math.abs(out.typedChars - desk.typed.length)).toBeLessThanOrEqual(8);
  });

  it("emergency stop at the PC ends typing within 500 ms and blocks new requests until resumed (AC-P11-3)", async () => {
    const sock = join(dir, "c.sock");
    const control = serveControl(companion, sock);
    try {
      const t = await target();
      desk.keyDelayMs = 8;
      const req = await api("/api/desktop/actions", human, { ...t, kind: "insert", text: "b".repeat(400) });
      await until(String(req.body.id), (s) => s === "running");
      await new Promise((r) => setTimeout(r, 100));
      const before = desk.typed.length;
      const t0 = performance.now();
      await sendControl("stop", sock);
      const out = await until(String(req.body.id), (s) => s === "failed" || s === "done");
      const stopMs = performance.now() - t0;
      expect(out).toMatchObject({ status: "failed", detail: expect.stringMatching(/Not-Stopp/) });
      expect(desk.typed.length).toBeLessThanOrEqual(before + 8);
      expect(stopMs).toBeLessThan(500);
      await new Promise((r) => setTimeout(r, 60));
      const blocked = await api("/api/desktop/actions", human, { ...(await target()), kind: "insert", text: "x" });
      expect(blocked.status).toBe(409);
      expect(String(blocked.body.error)).toMatch(/Not-Stopp/);
      expect(JSON.parse(await sendControl("resume", sock))).toMatchObject({ paused: false });
    } finally {
      control.close();
    }
  });

  it("cancel from the phone stops the typing", async () => {
    const t = await target();
    desk.keyDelayMs = 8;
    const req = await api("/api/desktop/actions", human, { ...t, kind: "insert", text: "c".repeat(400) });
    await until(String(req.body.id), (s) => s === "running");
    await api(`/api/desktop/actions/${String(req.body.id)}/cancel`, human, {});
    const out = await until(String(req.body.id), (s) => s === "failed" || s === "done");
    expect(out).toMatchObject({ status: "failed", detail: expect.stringMatching(/Vom Handy abgebrochen/) });
    expect(desk.typed.length).toBeLessThan(400);
  });

  it("password fields and locked screens are refused; only the companion's routes are reachable with its token", async () => {
    companion.shutdown();
    await running;
    companion = new Companion({ hub, token: companionToken, focus: desk, input: desk, focusMs: 20, focusedRole: async () => "password text" });
    running = companion.run();
    const req = await api("/api/desktop/actions", human, { ...(await target()), kind: "insert", text: "hunter2" });
    expect((await until(String(req.body.id), (s) => s === "refused")).detail).toMatch(/Passwortfeld/);
    desk.isLocked = true;
    await new Promise((r) => setTimeout(r, 80));
    expect((await api("/api/desktop/actions", human, { ...(await target()), kind: "insert", text: "x" })).status).toBe(409);
    expect(desk.typed).toBe("");
    // Token boundaries.
    expect((await api("/api/sessions", companionToken)).status).toBe(403);
    expect((await api("/api/desktop", companionToken)).status).toBe(403);
    expect((await api("/api/desktop/companion/next?wait=0", human)).status).toBe(403);
    const agent = tokens.issue("agent:mcp").token;
    expect((await api("/api/desktop/actions", agent, { ...(await target()), kind: "insert", text: "x" })).status).toBe(403);
  });

  it("a revoked token ends the companion with a reason", async () => {
    await target();
    tokens.revoke("companion:omarchy");
    await running;
    expect(companion.exitReason).toMatch(/Token widerrufen/);
  });
});

describe("desktop backends (T11.1)", () => {
  it("Hyprland: focus from `hyprctl activewindow -j`, lock from hyprlock", async () => {
    const calls: string[] = [];
    const exe = async (cmd: string, args: string[]) => {
      calls.push(`${cmd} ${args.join(" ")}`);
      if (cmd === "hyprctl") return JSON.stringify({ address: "0x5620", class: "foot", title: "~/p", pid: 42 });
      if (cmd === "pgrep" && args[1] === "hyprlock") return "123\n";
      throw new Error("no");
    };
    const h = new HyprlandBackend(exe);
    expect(await h.focus()).toEqual({ id: "0x5620", app: "foot", title: "~/p", pid: 42 });
    expect(await h.locked()).toBe(true);
    const none = new HyprlandBackend(async (cmd) => (cmd === "hyprctl" ? "{}" : Promise.reject(new Error("x"))));
    expect(await none.focus()).toBeNull();
    expect(await none.locked()).toBe(false);
  });

  it("sway: the focused leaf of the tree", async () => {
    const tree = { id: 1, nodes: [{ id: 2, nodes: [{ id: 5, focused: true, app_id: "zenity", name: "AncientVoid-Test", pid: 7 }] }] };
    const s = new SwayBackend(async () => JSON.stringify(tree));
    expect(await s.focus()).toEqual({ id: "5", app: "zenity", title: "AncientVoid-Test", pid: 7 });
  });

  it("wtype: one process per action, text after --, a delay per key, undo as ctrl+z, select-all as ctrl+a", async () => {
    const calls: string[][] = [];
    const w = new WtypeInput(async (_cmd, args) => {
      calls.push(args);
      return "";
    });
    const s = new AbortController().signal;
    await w.type("-k Return", s);
    await w.key("undo", s);
    await w.key("Tab", s);
    await w.selectAll(s);
    expect(calls).toEqual([
      ["-s", "30", "-d", "8", "--", "-k Return"],
      ["-s", "30", "-M", "ctrl", "z", "-m", "ctrl"],
      ["-s", "30", "-k", "Tab"],
      ["-s", "30", "-M", "ctrl", "a", "-m", "ctrl"],
    ]);
  });

  it("Hyprland targeted paste sends clipboard content only to the previewed window", async () => {
    const calls: string[][] = [];
    const offered: string[] = [];
    const exe = async (_cmd: string, args: string[]) => {
      calls.push(args);
      return "ok";
    };
    const input = new HyprlandInput(exe, 8, async (text, _target, _signal, sendPaste) => {
      offered.push(text);
      await sendPaste();
    });
    await input.type("npm test äöü", new AbortController().signal, "0xabc", "targeted-paste");
    expect(offered).toEqual(["npm test äöü"]);
    expect(calls).toEqual([["dispatch", "sendshortcut", "CTRL,V,address:0xabc"]]);
  });

  it("Hyprland refuses unfocused keystroke text unless targeted paste was explicitly selected", async () => {
    const calls: string[][] = [];
    const input = new HyprlandInput(async (_cmd, args) => { calls.push(args); return "ok"; }, 8, async () => undefined);
    await expect(input.type("must not leak", new AbortController().signal, "0xabc"))
      .rejects.toThrow(/Gezielt einfügen/);
    expect(calls).toEqual([]);
  });

  it("Hyprland keys and replace selection are addressed to the previewed window", async () => {
    const calls: string[][] = [];
    const input = new HyprlandInput(async (_cmd, args) => { calls.push(args); return "ok"; }, 8, async () => undefined);
    const signal = new AbortController().signal;
    await input.selectAll(signal, "0xabc");
    await input.key("Return", signal, "0xabc");
    await input.key("undo", signal, "0xabc");
    expect(calls).toEqual([
      ["dispatch", "sendshortcut", "CTRL,A,address:0xabc"],
      ["dispatch", "sendshortcut", ",Return,address:0xabc"],
      ["dispatch", "sendshortcut", "CTRL,Z,address:0xabc"],
    ]);
  });

  it("Hyprland never interpolates an invalid window address into a dispatcher", async () => {
    let called = false;
    const input = new HyprlandInput(async () => { called = true; return "ok"; }, 8, async () => undefined);
    await expect(input.type("text", new AbortController().signal, "0xabc;exec evil", "targeted-paste")).rejects.toThrow(/window address/);
    expect(called).toBe(false);
  });
});
