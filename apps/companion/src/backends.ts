import { execFile, spawn } from "node:child_process";
import { createConnection } from "node:net";
import { join } from "node:path";
import type { DesktopInputMode } from "@uacc/contracts";

/**
 * EPIC-P11 (ADR-0031): what the companion needs from the desktop — which
 * window has the focus, whether the screen is locked, and a keyboard.
 * Hyprland and sway report the focus over their IPC; typing goes through
 * the Wayland virtual-keyboard protocol (wtype). No screenshots, no mouse.
 */
export interface FocusInfo {
  id: string;
  app: string;
  title: string;
  pid: number | null;
}

export interface FocusBackend {
  readonly name: string;
  focus(): Promise<FocusInfo | null>;
  locked(): Promise<boolean>;
  /** Focus-change events pushed by the compositor (faster than polling); returns unsubscribe. */
  watch?(onChange: () => void): () => void;
}

export interface InputBackend {
  /** Milliseconds per key (to estimate how far typing got when stopped). */
  readonly keyDelayMs?: number;
  /** Types text; a signal abort kills the typing at once. */
  type(text: string, signal: AbortSignal, targetId?: string, mode?: DesktopInputMode): Promise<void>;
  key(key: "Return" | "Tab" | "Escape" | "undo", signal: AbortSignal, targetId?: string): Promise<void>;
  selectAll(signal: AbortSignal, targetId?: string): Promise<void>;
  /** Uses a one-shot clipboard offer and compositor-targeted paste, when supported. */
  targetedPaste?(text: string, targetId: string, signal: AbortSignal): Promise<void>;
}

export type Exec = (cmd: string, args: string[], opts?: { signal?: AbortSignal; timeoutMs?: number }) => Promise<string>;

export const exec: Exec = (cmd, args, opts = {}) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: opts.timeoutMs ?? 5000, maxBuffer: 16 * 1024 * 1024, ...(opts.signal ? { signal: opts.signal } : {}) }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });

async function running(exe: Exec, name: string): Promise<boolean> {
  return exe("pgrep", ["-x", name]).then(
    () => true,
    () => false,
  );
}

export class HyprlandBackend implements FocusBackend {
  readonly name = "hyprland";
  private readonly exe: Exec;
  constructor(exe: Exec = exec) {
    this.exe = exe;
  }
  async focus(): Promise<FocusInfo | null> {
    const w = JSON.parse(await this.exe("hyprctl", ["activewindow", "-j"])) as { address?: string; class?: string; title?: string; pid?: number };
    return w.address ? { id: w.address, app: w.class ?? "", title: w.title ?? "", pid: w.pid ?? null } : null;
  }
  async locked(): Promise<boolean> {
    return (await running(this.exe, "hyprlock")) || (await running(this.exe, "swaylock"));
  }
  /** socket2: `activewindowv2>>…` on every focus change. */
  watch(onChange: () => void, env: NodeJS.ProcessEnv = process.env): () => void {
    const sig = env.HYPRLAND_INSTANCE_SIGNATURE;
    if (!sig) return () => undefined;
    const sock = createConnection(join(env.XDG_RUNTIME_DIR ?? "/tmp", "hypr", sig, ".socket2.sock"));
    sock.setEncoding("utf8");
    sock.on("data", (d: string) => {
      if (/^activewindowv2>>/m.test(d)) onChange();
    });
    sock.on("error", () => undefined);
    return () => sock.destroy();
  }
}

interface SwayNode {
  id: number;
  focused?: boolean;
  app_id?: string | null;
  name?: string | null;
  pid?: number;
  window_properties?: { class?: string };
  nodes?: SwayNode[];
  floating_nodes?: SwayNode[];
}

export class SwayBackend implements FocusBackend {
  readonly name = "sway";
  private readonly exe: Exec;
  private readonly swaymsg: string;
  constructor(exe: Exec = exec, swaymsg = "swaymsg") {
    this.exe = exe;
    this.swaymsg = swaymsg;
  }
  async focus(): Promise<FocusInfo | null> {
    const tree = JSON.parse(await this.exe(this.swaymsg, ["-t", "get_tree"])) as SwayNode;
    const find = (n: SwayNode): SwayNode | null => {
      if (n.focused && (n.app_id || n.window_properties)) return n;
      for (const c of [...(n.nodes ?? []), ...(n.floating_nodes ?? [])]) {
        const hit = find(c);
        if (hit) return hit;
      }
      return null;
    };
    const f = find(tree);
    return f ? { id: String(f.id), app: f.app_id ?? f.window_properties?.class ?? "", title: f.name ?? "", pid: f.pid ?? null } : null;
  }
  async locked(): Promise<boolean> {
    return running(this.exe, "swaylock");
  }
  /** `swaymsg -t subscribe -m '["window"]'`: a line per window event; "focus" ones count. */
  watch(onChange: () => void): () => void {
    const p = spawn(this.swaymsg, ["-t", "subscribe", "-m", '["window"]'], { stdio: ["ignore", "pipe", "ignore"] });
    p.stdout.setEncoding("utf8");
    p.stdout.on("data", (d: string) => {
      if (/"change":\s*"focus"/.test(d)) onChange();
    });
    p.on("error", () => undefined);
    return () => p.kill();
  }
}

/**
 * Typing via the virtual-keyboard protocol (Hyprland, sway, …). One wtype
 * process per action (every new virtual keyboard needs `-s` before its
 * first key), with a fixed delay per key so the companion's focus watch can
 * stop it within a few characters — wtype types into whatever has the focus.
 */
export class WtypeInput implements InputBackend {
  private readonly exe: Exec;
  private readonly wtype: string;
  readonly keyDelayMs: number;
  constructor(exe: Exec = exec, wtype = "wtype", keyDelayMs = 8) {
    this.exe = exe;
    this.wtype = wtype;
    this.keyDelayMs = keyDelayMs;
  }
  async type(text: string, signal: AbortSignal): Promise<void> {
    await this.exe(this.wtype, ["-s", "30", "-d", String(this.keyDelayMs), "--", text], { signal, timeoutMs: 120_000 });
  }
  async key(key: "Return" | "Tab" | "Escape" | "undo", signal: AbortSignal): Promise<void> {
    await this.exe(this.wtype, ["-s", "30", ...(key === "undo" ? ["-M", "ctrl", "z", "-m", "ctrl"] : ["-k", key])], { signal });
  }
  async selectAll(signal: AbortSignal): Promise<void> {
    await this.exe(this.wtype, ["-s", "30", "-M", "ctrl", "a", "-m", "ctrl"], { signal });
  }
}

type TargetedPaste = (text: string, targetId: string, signal: AbortSignal, pasteShortcut: () => Promise<void>) => Promise<void>;

function targetAddress(id: string): string {
  if (!/^0x[0-9a-f]+$/i.test(id)) throw new Error("Ungültige Hyprland window address.");
  return `address:${id}`;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("aborted"));
    const timer = setTimeout(done, ms);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(new Error("aborted"));
    };
    function done() {
      signal.removeEventListener("abort", abort);
      resolve();
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}

/**
 * The child is isolated in its own process group so a failed/ignored paste
 * cannot leave this text available to the next unrelated clipboard request.
 */
const pasteOnce: TargetedPaste = async (text, _targetId, signal, pasteShortcut) => {
  const child = spawn("wl-copy", ["--paste-once", "--sensitive", "--type", "text/plain;charset=utf-8"], {
    detached: true,
    stdio: ["pipe", "ignore", "ignore"],
  });
  const pid = child.pid;
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null; error?: Error }>((resolve) => {
    child.once("error", (error) => resolve({ code: null, signal: null, error }));
    child.once("close", (code, childSignal) => resolve({ code, signal: childSignal }));
  });
  child.stdin.on("error", () => undefined);
  child.stdin.end(text);

  const killGroup = async () => {
    if (!pid) return;
    const signalGroup = (signal: NodeJS.Signals) => {
      try { process.kill(-pid, signal); return true; }
      catch (err) { return (err as NodeJS.ErrnoException).code !== "ESRCH"; }
    };
    if (!signalGroup("SIGTERM")) return;
    const deadline = Date.now() + 100;
    while (Date.now() < deadline) {
      try { process.kill(-pid, 0); }
      catch (err) { if ((err as NodeJS.ErrnoException).code === "ESRCH") return; }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    signalGroup("SIGKILL");
  };
  try {
    const ready = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; error?: Error }>((resolve, reject) => {
      const timer = setTimeout(() => finish(() => reject(new Error("Zwischenablage-Timeout — nichts eingefügt."))), 2_000);
      const abort = () => finish(() => reject(new Error("aborted")));
      const finish = (done: () => void) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        done();
      };
      if (signal.aborted) return abort();
      signal.addEventListener("abort", abort, { once: true });
      void closed.then((value) => finish(() => resolve(value)));
    });
    if (ready.error) throw new Error(`wl-copy konnte nicht starten: ${ready.error.message}`);
    if (ready.code !== 0) throw new Error(`wl-copy endete vor dem Einfügen (${ready.code ?? ready.signal ?? "unbekannt"}).`);

    await pasteShortcut();
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      if (signal.aborted) throw new Error("aborted");
      let alive = false;
      if (pid) {
        try { process.kill(-pid, 0); alive = true; }
        catch (err) { if ((err as NodeJS.ErrnoException).code !== "ESRCH") throw err; }
      }
      if (!alive) return;
      await wait(10, signal);
    }
    throw new Error("Die Ziel-App hat das Einfügen nicht abgefragt — Clipboard-Angebot beendet.");
  } finally {
    await killGroup();
  }
};

/** Hyprland can address keyboard shortcuts to a window, unlike wtype. */
export class HyprlandInput implements InputBackend {
  private readonly exe: Exec;
  private readonly keyboard: WtypeInput;
  private readonly paste: TargetedPaste;
  readonly keyDelayMs: number;

  constructor(exe: Exec = exec, keyDelayMs = 8, paste: TargetedPaste = pasteOnce) {
    this.exe = exe;
    this.keyboard = new WtypeInput(exe, "wtype", keyDelayMs);
    this.keyDelayMs = keyDelayMs;
    this.paste = paste;
  }

  type(text: string, signal: AbortSignal, targetId?: string, mode: DesktopInputMode = "keystroke"): Promise<void> {
    if (mode === "targeted-paste") {
      if (!targetId) throw new Error("Gezieltes Einfügen braucht eine window address.");
      return this.targetedPaste(text, targetId, signal);
    }
    return Promise.reject(new Error('Hyprland sendet Text nur mit „Gezielt einfügen“ an das bestätigte Fenster.'));
  }

  async targetedPaste(text: string, targetId: string, signal: AbortSignal): Promise<void> {
    const window = targetAddress(targetId);
    await this.paste(text, targetId, signal, () => this.shortcut("CTRL,V", window, signal));
  }

  async key(key: "Return" | "Tab" | "Escape" | "undo", signal: AbortSignal, targetId?: string): Promise<void> {
    if (!targetId) return this.keyboard.key(key, signal);
    const window = targetAddress(targetId);
    await this.shortcut(key === "undo" ? "CTRL,Z" : `,${key}`, window, signal);
  }

  async selectAll(signal: AbortSignal, targetId?: string): Promise<void> {
    if (!targetId) return this.keyboard.selectAll(signal);
    await this.shortcut("CTRL,A", targetAddress(targetId), signal);
  }

  private async shortcut(keys: string, window: string | undefined, signal: AbortSignal): Promise<void> {
    const arg = window ? `${keys},${window}` : keys;
    await this.exe("hyprctl", ["dispatch", "sendshortcut", arg], { signal, timeoutMs: 2_000 });
  }
}

/** Auto-detect from the session's environment. */
export function detectBackend(env: NodeJS.ProcessEnv = process.env): FocusBackend | null {
  if (env.HYPRLAND_INSTANCE_SIGNATURE) return new HyprlandBackend();
  if (env.SWAYSOCK) return new SwayBackend();
  return null;
}
