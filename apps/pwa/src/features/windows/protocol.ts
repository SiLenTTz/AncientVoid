import { pageHash, sessionHash, TOOL_PAGE_IDS, type ToolPageId } from "../../app/route.ts";

/**
 * EPIC-P34 T34.10 (ADR-0053): Abstimmung zwischen dem Hauptfenster und eigenen Fenstern über
 * `BroadcastChannel("ancientvoid.windows")`. Reine Daten und Regeln; Kanal und Fenster stehen in `windows.ts`
 * und `PopoutShell.tsx`. Das Hauptfenster ist optional: Fenster laufen allein weiter und melden sich auf `ping` neu.
 */
export const WINDOW_CHANNEL = "ancientvoid.windows";
export const HEARTBEAT_MS = 3000;
/** Zwei verpasste Herzschläge plus Puffer. */
export const WINDOW_TTL_MS = 10_000;

export type WindowTarget = { kind: "session"; sessionId: string; hostId?: string } | { kind: "tool"; page: ToolPageId };

export type WindowMessage =
  | { type: "hello"; id: string; target: WindowTarget }
  | { type: "heartbeat"; id: string }
  | { type: "bye"; id: string }
  | { type: "focus"; id: string }
  | { type: "return"; id: string; target: WindowTarget }
  /** Das Hauptfenster (neu gestartet) bittet alle Fenster, sich zu melden. */
  | { type: "ping" };

export interface WindowEntry {
  id: string;
  target: WindowTarget;
  lastSeen: number;
}
export type WindowRegistry = Record<string, WindowEntry>;

export function targetKey(target: WindowTarget): string {
  return target.kind === "tool" ? `tool:${target.page}` : `session:${target.hostId ?? ""}|${target.sessionId}`;
}

/** Das Token steht nie in der URL — es liegt im gemeinsamen localStorage. */
export function popoutUrl(target: WindowTarget): string {
  const hash = target.kind === "tool" ? pageHash(target.page) : sessionHash(target.sessionId, target.hostId);
  return `/?window=1${hash}`;
}

function parseTarget(raw: unknown): WindowTarget | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as { kind?: unknown; sessionId?: unknown; hostId?: unknown; page?: unknown };
  if (t.kind === "tool") return (TOOL_PAGE_IDS as readonly unknown[]).includes(t.page) ? { kind: "tool", page: t.page as ToolPageId } : null;
  if (t.kind === "session" && typeof t.sessionId === "string" && t.sessionId) {
    return typeof t.hostId === "string" && t.hostId ? { kind: "session", sessionId: t.sessionId, hostId: t.hostId } : { kind: "session", sessionId: t.sessionId };
  }
  return null;
}

/** Nachrichten kommen aus einem Kanal, den jede Seite des Ursprungs beschreiben kann: nichts ungeprüft annehmen. */
export function parseWindowMessage(raw: unknown): WindowMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as { type?: unknown; id?: unknown; target?: unknown };
  if (m.type === "ping") return { type: "ping" };
  if (typeof m.id !== "string" || !m.id) return null;
  if (m.type === "heartbeat" || m.type === "bye" || m.type === "focus") return { type: m.type, id: m.id };
  if (m.type === "hello" || m.type === "return") {
    const target = parseTarget(m.target);
    return target ? { type: m.type, id: m.id, target } : null;
  }
  return null;
}

export function applyWindowMessage(reg: WindowRegistry, msg: WindowMessage, now: number): WindowRegistry {
  switch (msg.type) {
    case "hello": {
      // Ein Fenster je Ziel: ein Reload meldet sich mit neuer ID und ersetzt das alte.
      const next: WindowRegistry = Object.fromEntries(Object.entries(reg).filter(([, e]) => targetKey(e.target) !== targetKey(msg.target)));
      next[msg.id] = { id: msg.id, target: msg.target, lastSeen: now };
      return next;
    }
    case "heartbeat":
      // Ohne hello unbekannt: kein Phantomfenster aus einem verspäteten Herzschlag.
      return reg[msg.id] ? { ...reg, [msg.id]: { ...reg[msg.id]!, lastSeen: now } } : reg;
    case "bye":
    case "return": {
      const { [msg.id]: _gone, ...rest } = reg;
      return rest;
    }
    default:
      return reg;
  }
}

export function pruneWindows(reg: WindowRegistry, now: number): WindowRegistry {
  return Object.fromEntries(Object.entries(reg).filter(([, e]) => now - e.lastSeen <= WINDOW_TTL_MS));
}

export function windowFor(reg: WindowRegistry, target: WindowTarget): WindowEntry | null {
  return Object.values(reg).find((e) => targetKey(e.target) === targetKey(target)) ?? null;
}
