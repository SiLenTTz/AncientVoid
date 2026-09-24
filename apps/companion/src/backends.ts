import { execFile, spawn } from "node:child_process";
import { createConnection } from "node:net";
import { join } from "node:path";

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
  type(text: string, signal: AbortSignal): Promise<void>;
  key(key: "Return" | "Tab" | "Escape" | "undo", signal: AbortSignal): Promise<void>;
  selectAll(signal: AbortSignal): Promise<void>;
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

/** Auto-detect from the session's environment. */
export function detectBackend(env: NodeJS.ProcessEnv = process.env): FocusBackend | null {
  if (env.HYPRLAND_INSTANCE_SIGNATURE) return new HyprlandBackend();
  if (env.SWAYSOCK) return new SwayBackend();
  return null;
}
