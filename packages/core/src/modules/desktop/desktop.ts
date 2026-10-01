import { randomBytes } from "node:crypto";
import { credentialTarget, type CompanionState, type DeliveredDesktopAction, type DesktopAction, type DesktopActionRequest, type DesktopInputMode, type DesktopResult } from "@uacc/contracts";
import type { HubDatabase } from "../../platform/index.ts";

/**
 * EPIC-P11 (ADR-0031): the hub's side of the desktop companion. Companions
 * report their focus and long-poll for work; a person's request is checked
 * against the focus they saw and handed out once. Nothing is ever handed
 * out twice — after a hub restart, open actions are "uncertain", not
 * replayed (AC-P11-5).
 */
export interface DesktopOptions {
  /** A companion not heard from for this long is offline. */
  onlineMs?: number;
  /** A request not fetched within this time is stale (the view moved on). */
  pickupMs?: number;
  /** Delivered but never reported: the outcome is unknown. */
  reportMs?: number;
  now?: () => number;
}

interface Waiter {
  resolve: (r: { actions: DeliveredDesktopAction[]; cancel: string[] }) => void;
  timer: ReturnType<typeof setTimeout>;
}

const FINAL = new Set(["done", "failed", "refused", "cancelled", "expired", "uncertain"]);

function actionFromState(state: string): DesktopAction {
  const action = JSON.parse(state) as Omit<DesktopAction, "inputMode"> & { inputMode?: DesktopInputMode };
  return { ...action, inputMode: action.inputMode ?? "keystroke" };
}

export class DesktopService {
  private readonly db: HubDatabase;
  private readonly states = new Map<string, Omit<CompanionState, "online">>();
  private readonly waiters = new Map<string, Waiter>();
  private readonly cancels = new Map<string, Set<string>>();
  private readonly opts: Required<Omit<DesktopOptions, "now">> & { now: () => number };

  constructor(db: HubDatabase, opts: DesktopOptions = {}) {
    this.db = db;
    this.opts = { onlineMs: opts.onlineMs ?? 15_000, pickupMs: opts.pickupMs ?? 10_000, reportMs: opts.reportMs ?? 120_000, now: opts.now ?? Date.now };
    // AC-P11-5: whatever was open when the hub stopped is not run again.
    for (const a of this.all()) {
      if (a.status === "pending") this.update(a.id, { status: "expired", detail: "Hub neu gestartet, bevor der Companion den Auftrag abholte." });
      else if (a.status === "delivered" || a.status === "running") this.update(a.id, { status: "uncertain", detail: "Hub neu gestartet — ob und wie weit getippt wurde, ist unbekannt. Nichts wird wiederholt." });
    }
  }

  private iso(): string {
    return new Date(this.opts.now()).toISOString();
  }

  // ---- companion side ------------------------------------------------------

  report(name: string, state: Omit<CompanionState, "name" | "lastSeen" | "online">): CompanionState {
    const blocked = state.blocked ?? (state.focus ? credentialTarget(state.focus.app, state.focus.title) : null);
    const s = { ...state, blocked, name, lastSeen: this.iso() };
    this.states.set(name, s);
    return { ...s, online: true };
  }

  /** Long poll: open actions for this companion (marked delivered) and cancellations. */
  next(name: string, waitMs: number): Promise<{ actions: DeliveredDesktopAction[]; cancel: string[] }> {
    const known = this.states.get(name);
    if (known) this.states.set(name, { ...known, lastSeen: this.iso() });
    const ready = this.take(name);
    if (ready.actions.length || ready.cancel.length || waitMs <= 0) return Promise.resolve(ready);
    this.waiters.get(name)?.resolve({ actions: [], cancel: [] });
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(name);
        resolve(this.take(name));
      }, waitMs);
      this.waiters.set(name, { resolve, timer });
    });
  }

  private take(name: string): { actions: DeliveredDesktopAction[]; cancel: string[] } {
    this.expire();
    const rows = this.db.prepare("SELECT state, text FROM desktop_actions WHERE companion = ? ORDER BY created_at").all(name) as { state: string; text: string | null }[];
    const actions: DeliveredDesktopAction[] = [];
    for (const r of rows) {
      const a = actionFromState(r.state);
      if (a.status !== "pending") continue;
      actions.push({ ...this.update(a.id, { status: "delivered" })!, text: r.text });
    }
    const cancel = [...(this.cancels.get(name) ?? [])];
    this.cancels.delete(name);
    return { actions, cancel };
  }

  private wake(name: string): void {
    const w = this.waiters.get(name);
    if (!w) return;
    clearTimeout(w.timer);
    this.waiters.delete(name);
    w.resolve(this.take(name));
  }

  result(name: string, id: string, r: DesktopResult): DesktopAction | undefined {
    const a = this.get(id);
    if (!a || a.companion !== name || FINAL.has(a.status)) return a;
    const next = this.update(id, { status: r.status, detail: r.detail, typedChars: r.typedChars });
    // The text is only needed until the companion has it; never kept after.
    if (r.status !== "running") this.db.prepare("UPDATE desktop_actions SET text = NULL WHERE id = ?").run(id);
    return next;
  }

  /** Hub shutdown: open long polls answer at once (empty), so close() isn't held up. */
  close(): void {
    for (const [name, w] of this.waiters) {
      clearTimeout(w.timer);
      w.resolve({ actions: [], cancel: [] });
      this.waiters.delete(name);
    }
  }

  // ---- person side -----------------------------------------------------------

  companions(): CompanionState[] {
    const now = this.opts.now();
    return [...this.states.values()].map((s) => ({ ...s, online: now - Date.parse(s.lastSeen) <= this.opts.onlineMs }));
  }

  /** Throws in words when the request can't be honoured right now. */
  request(req: DesktopActionRequest, requestedBy: string): DesktopAction {
    const c = this.companions().find((x) => x.name === req.companion);
    if (!c) throw Object.assign(new Error(`Companion „${req.companion}“ ist nicht verbunden.`), { status: 404 });
    if (!c.online) throw Object.assign(new Error(`Companion „${c.name}“ ist offline.`), { status: 409 });
    if (c.paused) throw Object.assign(new Error("Am PC wurde der Not-Stopp gedrückt — erst dort wieder freigeben."), { status: 409 });
    if (c.locked) throw Object.assign(new Error("Der Bildschirm am PC ist gesperrt."), { status: 409 });
    if (!c.focus) throw Object.assign(new Error("Am PC hat kein Fenster den Fokus."), { status: 409 });
    if (c.focus.id !== req.target.id || c.focus.revision !== req.target.revision) throw Object.assign(new Error(`Der Fokus am PC hat sich geändert (jetzt: ${c.focus.app} — ${c.focus.title}). Bitte das Ziel neu prüfen.`), { status: 409 });
    if (c.blocked) throw Object.assign(new Error(c.blocked), { status: 403 });
    if (req.inputMode === "targeted-paste" && c.backend !== "hyprland") throw Object.assign(new Error("Gezieltes Einfügen ist nur auf Hyprland verfügbar."), { status: 422 });
    const at = this.iso();
    const action: DesktopAction = {
      id: `d_${randomBytes(6).toString("hex")}`,
      companion: c.name,
      kind: req.kind,
      inputMode: req.inputMode ?? "keystroke",
      key: req.key ?? null,
      textLength: req.text?.length ?? 0,
      target: { id: c.focus.id, revision: c.focus.revision, app: c.focus.app, title: c.focus.title },
      status: "pending",
      detail: null,
      typedChars: 0,
      requestedBy,
      createdAt: at,
      updatedAt: at,
    };
    this.db.prepare("INSERT INTO desktop_actions (id, companion, created_at, state, text) VALUES (?, ?, ?, ?, ?)").run(action.id, action.companion, at, JSON.stringify(action), req.text ?? null);
    this.wake(c.name);
    return action;
  }

  cancel(id: string): DesktopAction | undefined {
    const a = this.get(id);
    if (!a || FINAL.has(a.status)) return a;
    if (a.status === "pending") {
      this.db.prepare("UPDATE desktop_actions SET text = NULL WHERE id = ?").run(id);
      return this.update(id, { status: "cancelled", detail: "Vor dem Abholen abgebrochen." });
    }
    // Delivered/running: the companion stops between two chunks and reports.
    const set = this.cancels.get(a.companion) ?? new Set<string>();
    set.add(id);
    this.cancels.set(a.companion, set);
    this.wake(a.companion);
    return a;
  }

  get(id: string): DesktopAction | undefined {
    const row = this.db.prepare("SELECT state FROM desktop_actions WHERE id = ?").get(id) as { state: string } | undefined;
    return row ? actionFromState(row.state) : undefined;
  }

  list(limit = 30): DesktopAction[] {
    this.expire();
    return (this.db.prepare("SELECT state FROM desktop_actions ORDER BY created_at DESC LIMIT ?").all(limit) as { state: string }[]).map((r) => actionFromState(r.state));
  }

  private all(): DesktopAction[] {
    return (this.db.prepare("SELECT state FROM desktop_actions").all() as { state: string }[]).map((r) => actionFromState(r.state));
  }

  /** Stale requests expire; delivered ones without a report become uncertain. */
  private expire(): void {
    const now = this.opts.now();
    for (const a of this.all()) {
      const age = now - Date.parse(a.updatedAt);
      if (a.status === "pending" && age > this.opts.pickupMs) {
        this.db.prepare("UPDATE desktop_actions SET text = NULL WHERE id = ?").run(a.id);
        this.update(a.id, { status: "expired", detail: "Der Companion hat den Auftrag nicht rechtzeitig abgeholt — nichts getippt." });
      } else if ((a.status === "delivered" || a.status === "running") && age > this.opts.reportMs) {
        this.db.prepare("UPDATE desktop_actions SET text = NULL WHERE id = ?").run(a.id);
        this.update(a.id, { status: "uncertain", detail: "Keine Rückmeldung vom Companion — ob getippt wurde, ist unbekannt." });
      }
    }
  }

  private update(id: string, patch: Partial<DesktopAction>): DesktopAction | undefined {
    const a = this.get(id);
    if (!a) return undefined;
    const next = { ...a, ...patch, updatedAt: this.iso() };
    this.db.prepare("UPDATE desktop_actions SET state = ? WHERE id = ?").run(JSON.stringify(next), id);
    return next;
  }
}
