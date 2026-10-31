import { credentialTarget, type DeliveredDesktopAction, type DesktopFocus } from "@ancientvoid/contracts";
import { exec, type Exec, type FocusBackend, type FocusInfo, type InputBackend } from "./backends.ts";

export * from "./backends.ts";

/**
 * EPIC-P11 (ADR-0031): the desktop companion. It watches the focus (every
 * `focusMs`), reports it to the hub and long-polls for work. Before each
 * chunk of text it checks again: same window, same focus revision, not
 * stopped, not cancelled — otherwise it stops and says how far it got.
 * Nothing is retried: an action is run once or reported as not run.
 */
export interface CompanionOptions {
  hub: string;
  token: string;
  focus: FocusBackend;
  input: InputBackend;
  /** App ids that may be typed into (empty: every app except credential windows). */
  allow?: string[];
  /** Optional: role of the focused widget ("password text" → refuse). */
  focusedRole?: (pid: number) => Promise<string | null>;
  focusMs?: number;
  /** Focus check interval while typing (the leak bound: interval ÷ key delay). */
  watchMs?: number;
  fetch?: typeof fetch;
  log?: (message: string) => void;
  version?: string;
}

export interface ActionOutcome {
  status: "done" | "failed" | "refused";
  detail: string | null;
  typedChars: number;
}

export class Companion {
  private readonly o: Required<Omit<CompanionOptions, "focusedRole" | "allow">> & Pick<CompanionOptions, "focusedRole" | "allow">;
  private focusNow: (FocusInfo & { revision: number }) | null = null;
  private revision = Math.floor(Date.now() / 1000);
  private lockedNow = false;
  paused = false;
  private running: { id: string; abort: AbortController } | null = null;
  private readonly cancelled = new Set<string>();
  private stopped = false;
  /** Aborts requests in flight (the long poll) on shutdown. */
  private readonly life = new AbortController();
  private lastReport = "";
  private lastReportAt = 0;
  /** Why the companion ended (token revoked …), for the CLI. */
  exitReason: string | null = null;

  constructor(opts: CompanionOptions) {
    this.o = { focusMs: 150, watchMs: 15, fetch: globalThis.fetch.bind(globalThis), log: () => undefined, version: "0.1.0", ...opts };
  }

  /** The focus with its revision — what the hub and the person see. */
  get focus(): DesktopFocus | null {
    return this.focusNow ? { id: this.focusNow.id, app: this.focusNow.app, title: this.focusNow.title, revision: this.focusNow.revision } : null;
  }

  blockedReason(f: FocusInfo | null = this.focusNow): string | null {
    if (!f) return null;
    const cred = credentialTarget(f.app, f.title);
    if (cred) return cred;
    if (this.o.allow?.length && !this.o.allow.some((a) => a.toLowerCase() === f.app.toLowerCase())) return `Die App „${f.app}“ ist für den Companion nicht freigegeben (--allow).`;
    return null;
  }

  /** Reads the focus; a different window means a new revision. */
  async poll(): Promise<void> {
    const [f, locked] = await Promise.all([this.o.focus.focus().catch(() => null), this.o.focus.locked().catch(() => false)]);
    if ((f?.id ?? null) !== (this.focusNow?.id ?? null) || (f && this.focusNow && f.title !== this.focusNow.title)) this.revision++;
    // A window change while typing stops the typing now, not at the next chunk.
    if (this.running && f?.id !== this.focusNow?.id) this.running.abort.abort();
    this.focusNow = f ? { ...f, revision: this.revision } : null;
    if (locked && this.running) this.running.abort.abort();
    this.lockedNow = locked;
  }

  /** Emergency stop (local): kills the typing at once, nothing runs until resume(). */
  stop(): void {
    this.paused = true;
    this.running?.abort.abort();
    void this.report(true);
  }

  resume(): void {
    this.paused = false;
    void this.report(true);
  }

  status(): { paused: boolean; locked: boolean; focus: DesktopFocus | null; running: string | null; blocked: string | null } {
    return { paused: this.paused, locked: this.lockedNow, focus: this.focus, running: this.running?.id ?? null, blocked: this.blockedReason() };
  }

  private async api(path: string, init?: RequestInit): Promise<Response> {
    const res = await this.o.fetch(`${this.o.hub.replace(/\/$/, "")}${path}`, { ...init, signal: this.life.signal, headers: { "content-type": "application/json", authorization: `Bearer ${this.o.token}`, ...(init?.headers ?? {}) } });
    if (res.status === 401 || res.status === 403) {
      this.exitReason = `Hub lehnt den Companion ab (${res.status}) — Token widerrufen oder falsch.`;
      this.shutdown();
    }
    return res;
  }

  async report(force = false): Promise<void> {
    const state = { backend: this.o.focus.name, focus: this.focus, locked: this.lockedNow, paused: this.paused, blocked: this.blockedReason(), version: this.o.version };
    const key = JSON.stringify(state);
    if (!force && key === this.lastReport && Date.now() - this.lastReportAt < 5000) return;
    this.lastReport = key;
    this.lastReportAt = Date.now();
    await this.api("/api/desktop/companion/state", { method: "POST", body: key }).catch((err: unknown) => this.o.log(`state: ${String(err)}`));
  }

  private async result(id: string, r: { status: string; detail: string | null; typedChars: number }): Promise<void> {
    await this.api(`/api/desktop/companion/actions/${id}/result`, { method: "POST", body: JSON.stringify(r) }).catch((err: unknown) => this.o.log(`result: ${String(err)}`));
  }

  /** One action, once. Checks before each chunk; reports how far it got. */
  async execute(a: DeliveredDesktopAction): Promise<ActionOutcome> {
    await this.poll();
    const refuse = (detail: string): ActionOutcome => ({ status: "refused", detail, typedChars: 0 });
    if (this.paused) return refuse("Not-Stopp am PC ist aktiv.");
    if (this.lockedNow) return refuse("Der Bildschirm ist gesperrt.");
    const f = this.focusNow;
    if (!f) return refuse("Kein Fenster hat den Fokus.");
    if (f.id !== a.target.id || f.revision !== a.target.revision) return refuse(`Der Fokus hat sich seit der Vorschau geändert (jetzt: ${f.app} — ${f.title}). Nichts getippt.`);
    const blocked = this.blockedReason(f);
    if (blocked) return refuse(blocked);
    if (this.o.focusedRole && f.pid) {
      const role = await this.o.focusedRole(f.pid).catch(() => null);
      if (role && /password/i.test(role)) return refuse("Das fokussierte Feld ist ein Passwortfeld — hier tippt der Companion nicht.");
    }
    const abort = new AbortController();
    this.running = { id: a.id, abort };
    await this.result(a.id, { status: "running", detail: null, typedChars: 0 });
    let typed = 0;
    let focusEvent = false;
    const startedAt = performance.now();
    const why = (): string | null => {
      if (focusEvent) return "Fokus hat sich beim Tippen geändert";
      if (this.cancelled.has(a.id)) return "Vom Handy abgebrochen";
      if (this.paused) return "Not-Stopp am PC";
      if (this.lockedNow) return "Bildschirm gesperrt";
      if (this.focusNow?.id !== a.target.id) return "Fokus hat sich beim Tippen geändert";
      return null;
    };
    try {
      if (a.kind === "key") {
        await this.o.input.key(a.key!, abort.signal, a.target.id);
        return { status: "done", detail: `Taste ${a.key}`, typedChars: 0 };
      }
      if (a.kind === "replace") await this.o.input.selectAll(abort.signal, a.target.id);
      const text = a.text ?? "";
      // A virtual keyboard types into whatever has the focus: while it types,
      // the focus is checked every few milliseconds and typing is killed on
      // any change (ADR-0031). How far it got is estimated from the key delay.
      let watching = true;
      // Pushed focus events stop the typing at once; the poll is the fallback.
      const unwatch =
        this.o.focus.watch?.(() => {
          focusEvent = true;
          abort.abort();
        }) ?? (() => undefined);
      const watch = (async () => {
        while (watching) {
          await new Promise((r) => setTimeout(r, this.o.watchMs));
          if (!watching) break;
          await this.poll();
          if (why()) abort.abort();
        }
      })();
      try {
        await this.o.input.type(text, abort.signal, a.target.id, a.inputMode);
        typed = text.length;
      } finally {
        watching = false;
        unwatch();
        await watch;
      }
      const late = why();
      if (late && late !== "Fokus hat sich beim Tippen geändert") return { status: "failed", detail: `${late} — nach ${typed} Zeichen.`, typedChars: typed };
      return { status: "done", detail: `${typed} Zeichen in ${a.target.app} getippt`, typedChars: typed };
    } catch (err) {
      const stop = why();
      const done = typed || (a.kind === "key" ? 0 : Math.min(a.textLength, estimateFrom(this.o.input.keyDelayMs, startedAt)));
      return { status: "failed", detail: stop ? `${stop} — nach etwa ${done} von ${a.textLength} Zeichen gestoppt.` : `Eingabe fehlgeschlagen: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`, typedChars: done };
    } finally {
      this.running = null;
      this.cancelled.delete(a.id);
    }
  }

  /** Runs until shutdown(): focus loop, state reports, long poll. */
  async run(): Promise<void> {
    const focusLoop = (async () => {
      while (!this.stopped) {
        await this.poll();
        await this.report();
        await new Promise((r) => setTimeout(r, this.o.focusMs));
      }
    })();
    const workLoop = (async () => {
      await this.poll();
      await this.report(true);
      while (!this.stopped) {
        try {
          const res = await this.api("/api/desktop/companion/next?wait=25000");
          if (!res.ok) {
            await new Promise((r) => setTimeout(r, 2000));
            continue;
          }
          const body = (await res.json()) as { actions: DeliveredDesktopAction[]; cancel: string[] };
          for (const id of body.cancel) {
            this.cancelled.add(id);
            if (this.running?.id === id) this.running.abort.abort();
          }
          for (const a of body.actions) {
            if (this.stopped) break;
            // Cancellations keep arriving while this action types.
            const side = this.watchCancels(a.id);
            const out = await this.execute(a);
            side.stop();
            this.o.log(`${a.id} ${out.status}: ${out.detail ?? ""}`);
            await this.result(a.id, out);
          }
        } catch (err) {
          if (this.stopped) break;
          this.o.log(`hub: ${String(err)}`);
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    })();
    await Promise.all([focusLoop, workLoop]);
  }

  /** While typing, a second short poll picks up a cancel from the phone. */
  private watchCancels(id: string): { stop: () => void } {
    let on = true;
    void (async () => {
      while (on && !this.stopped) {
        const res = await this.api("/api/desktop/companion/next?wait=0").catch(() => null);
        const body = res?.ok ? ((await res.json()) as { cancel: string[]; actions: DeliveredDesktopAction[] }) : null;
        if (body?.cancel.includes(id)) {
          this.cancelled.add(id);
          this.running?.abort.abort();
        }
        // Actions that arrive meanwhile are not run later — they were meant for "now".
        for (const late of body?.actions ?? []) await this.result(late.id, { status: "refused", detail: "Der Companion tippte gerade etwas anderes — bitte erneut senden.", typedChars: 0 });
        await new Promise((r) => setTimeout(r, 100));
      }
    })();
    return {
      stop: () => {
        on = false;
      },
    };
  }

  shutdown(): void {
    this.stopped = true;
    this.running?.abort.abort();
    this.life.abort();
  }
}

function estimateFrom(delay: number | undefined, since: number): number {
  return delay ? Math.floor((performance.now() - since) / delay) : 0;
}

/**
 * The focused widget's role; when none reports focus (some toolkits, headless
 * compositors), a visible password field anywhere in the app counts —
 * refusing too often beats typing into a secret field.
 */
const ATSPI = `
import sys, gi
gi.require_version('Atspi', '2.0')
from gi.repository import Atspi
pid = int(sys.argv[1])
F, S = Atspi.StateType.FOCUSED, Atspi.StateType.SHOWING
def walk(o, depth, found):
    if depth > 30: return None
    try:
        st = o.get_state_set()
        if st.contains(F) and o.get_role_name() != "application": return o
        if o.get_role_name() == "password text" and st.contains(S): found.append(o)
        n = o.get_child_count()
    except Exception:
        return None
    for i in range(min(n, 300)):
        c = o.get_child_at_index(i)
        r = walk(c, depth + 1, found) if c is not None else None
        if r: return r
    return None
d = Atspi.get_desktop(0)
for i in range(d.get_child_count()):
    a = d.get_child_at_index(i)
    if a is not None and a.get_process_id() == pid:
        found = []
        f = walk(a, 0, found)
        print(f.get_role_name() if f else ("password text" if found else ""))
        break
`;

/** The focused widget's accessibility role (GTK/Qt apps expose it); null when unknown. */
export function atspiRole(exe: Exec = exec): (pid: number) => Promise<string | null> {
  return async (pid) => (await exe("python3", ["-c", ATSPI, String(pid)], { timeoutMs: 2500 })).trim() || null;
}
