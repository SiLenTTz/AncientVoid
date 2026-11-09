import type { NormalizedEvent } from "../../shared/ws.ts";

export interface LoopGate {
  name: string;
  state: string;
  detail?: string;
}

export interface LoopView {
  line: string | null;
  mode: string | null;
  activity: string | null;
  paused: boolean;
  progress: { done: number; total: number; phase: string | null; step: string | null; source: string | null } | null;
  gate: LoopGate | null;
  /** Der Loop wartet auf eine Person (securesight Exit 3). */
  hold: string | null;
  /** Aktive Störungen des Loops; leer = gesund. */
  broken: string[];
  stats: { completed: number; inProgress: number } | null;
  report: { text: string | null; blob: string | null; counts: Record<string, number> } | null;
  notices: { level: string; reason: string; at: string; fundstelle?: string }[];
  /** Projektmodus (securesight `project`): Intake-Zustand und Lauf, nur wie gemeldet. */
  intake: { status: string | null; ready: boolean; next: string | null } | null;
  lauf: { task: string | null; phase: string | null } | null;
  lastCommand: string | null;
  /** Freigaben des Orchestrators (Hermes `user_gates`): Name → erteilt. */
  orchestrator: { userGates: Record<string, boolean>; note: string | null } | null;
}

const str = (x: unknown): string | null => (typeof x === "string" && x ? x : null);
const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

/**
 * EPIC-P19 T19.6: der Zustand eines Loops, ausschließlich aus seinen `loop.*`-Ereignissen gefaltet. Nichts wird
 * geschätzt: was der Loop nicht gemeldet hat, bleibt `null`. Spätere Ereignisse überschreiben frühere,
 * `loop.recovered` nimmt eine Störung oder den Halt zurück.
 */
export function deriveLoopView(events: readonly NormalizedEvent[]): LoopView {
  const sessionState = new Map<string, string>();
  const progressOf = new Map<string, NonNullable<LoopView["progress"]>>();
  const v: LoopView = { line: null, mode: null, activity: null, paused: false, progress: null, gate: null, hold: null, broken: [], stats: null, report: null, notices: [], intake: null, lauf: null, lastCommand: null, orchestrator: null };
  for (const e of events) {
    if (e.type !== "system") continue;
    const p = e.payload as Record<string, unknown>;
    const kind = str(p.kind);
    if (!kind?.startsWith("loop.")) continue;
    switch (kind) {
      case "loop.info":
        if (p.source === "intake") v.intake = { status: str(p.status), ready: p.ready === true, next: str(p.next) };
        if (p.source === "lauf-status") v.lauf = { task: str(p.task), phase: str(p.phase) };
        v.line = str(p.line) ?? v.line;
        v.mode = str(p.mode) ?? v.mode;
        v.activity = str(p.activity) ?? str(p.iterationStatus) ?? v.activity;
        if (str(p.activity)) v.paused = p.activity === "paused";
        break;
      case "loop.state": {
        const session = str(p.session);
        if (session && str(p.state)) sessionState.set(session, str(p.state)!);
        break;
      }
      case "loop.progress": {
        const done = num(p.done);
        const total = num(p.total);
        if (p.source === "hermes") {
          const raw = (p.userGates ?? {}) as Record<string, unknown>;
          v.orchestrator = { userGates: Object.fromEntries(Object.entries(raw).flatMap(([k, g]) => (typeof g === "boolean" ? [[k, g]] : []))), note: str(p.gateNote) };
        }
        if (done !== null && total !== null) {
          v.progress = { done, total, phase: str(p.phase), step: str(p.step), source: str(p.source) };
          const session = str(p.session);
          if (session) progressOf.set(session, v.progress);
        }
        const g = p.gate as Record<string, unknown> | undefined;
        if (g && str(g.name) && str(g.state)) v.gate = { name: str(g.name)!, state: str(g.state)!, ...(str(g.detail) ? { detail: str(g.detail)! } : {}) };
        break;
      }
      case "loop.stats":
        v.stats = { completed: num(p.completed) ?? 0, inProgress: num(p.inProgress) ?? 0 };
        break;
      case "loop.report": {
        const counts = Object.fromEntries(Object.entries((p.counts ?? {}) as Record<string, unknown>).flatMap(([k, n]) => (num(n) !== null ? [[k, n as number]] : [])));
        v.report = { text: str(p.text), blob: str(p.blob), counts };
        break;
      }
      case "loop.hold":
        v.hold = str(p.reason) ?? "ohne Angabe";
        break;
      case "loop.broken": {
        const reason = str(p.reason) ?? "gestört";
        if (!v.broken.includes(reason)) v.broken.push(reason);
        break;
      }
      case "loop.recovered":
        if (p.what === "hold") v.hold = null;
        else if (p.all === true) v.broken = [];
        else v.broken = v.broken.filter((r) => r !== str(p.reason));
        break;
      case "loop.notify":
        v.notices = [...v.notices, { level: str(p.level) ?? "?", reason: str(p.reason) ?? "", at: str(p.at) ?? e.ts, ...(str(p.fundstelle) ? { fundstelle: str(p.fundstelle)! } : {}) }].slice(-5);
        break;
      case "loop.command": {
        const c = str(p.command);
        v.lastCommand = c;
        if (c === "pause") v.paused = true;
        if (c === "resume") v.paused = false;
        if (typeof p.paused === "boolean") v.paused = p.paused;
        if (c === "setMode" || c === "set-mode" || str(p.mode)) v.mode = str(p.mode) ?? v.mode;
        break;
      }
    }
  }
  // Mehrere Sessions einer Linie: gezeigt wird die, an der gerade gearbeitet wird; sonst die zuletzt gemeldete.
  for (const [session, state] of sessionState) {
    const live = progressOf.get(session);
    if ((state === "working" || state === "waiting") && live) v.progress = live;
  }
  return v;
}

/** Eine Zeile für den Kopf der Session: „Loop · Name · Betriebsart“, mit Störung/Halt vorn. */
export function loopBadge(adapter: string, view: LoopView): { text: string; tone: "ok" | "warn" | "bad" } {
  const name = adapter.replace(/^loop:/, "");
  const base = `Loop · ${name}${view.mode ? ` · ${view.mode}` : ""}`;
  if (view.broken.length > 0) return { text: `${base} · gestört`, tone: "bad" };
  if (view.hold) return { text: `${base} · wartet auf dich`, tone: "warn" };
  if (view.paused) return { text: `${base} · pausiert`, tone: "warn" };
  return { text: base, tone: "ok" };
}
