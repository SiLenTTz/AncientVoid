/**
 * Leitstand-Protokoll der aSPARK-Factory (AsyncAPI 0.9.0, v:1). Reine Funktionen: Themen, Prüfung und
 * Übersetzung der Nachrichten. Alles, was von der Linie kommt, ist Daten; hier wird nichts davon ausgeführt.
 */

export const LINE_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** Betriebsarten der Linie; `dark` merged ohne Mensch und gilt darum als riskant. */
export const MODES = ["manual", "supervised", "autonomous", "dark"] as const;
/** Befehle, die ältere Runner ohne `commands` im Info-Topic verstehen. */
export const LEGACY_COMMANDS = ["pause", "resume", "set-mode", "next-steps", "work"] as const;

export const topics = {
  info: (line: string) => `agent/${line}/info`,
  answer: (line: string, session: string) => `agent/${line}/${session}/answer`,
  command: (line: string) => `agent/${line}/command`,
  subscriptions: (line: string) => [`agent/${line}/info`, `agent/${line}/+/state`, `agent/${line}/+/ask`, `agent/${line}/+/progress`, `agent/${line}/stats`, `agent/${line}/report`],
};

export type Parsed = { kind: "info" | "stats" | "report" } | { kind: "state" | "ask" | "progress"; session: string };

/** Ordnet ein Topic einer Nachrichtenart zu; `null` = nicht von dieser Linie erwartet. */
export function classify(line: string, topic: string): Parsed | null {
  const parts = topic.split("/");
  if (parts[0] !== "agent" || parts[1] !== line) return null;
  if (parts.length === 3 && (parts[2] === "info" || parts[2] === "stats" || parts[2] === "report")) return { kind: parts[2] };
  if (parts.length === 4 && parts[2] && (parts[3] === "state" || parts[3] === "ask" || parts[3] === "progress")) return { kind: parts[3], session: parts[2] };
  return null;
}

export type Decoded = { ok: true; value: Record<string, unknown> } | { ok: false; reason: string };

/** JSON-Objekt mit `v: 1`. Alles andere ist ein Bruch des Vertrags (`loop.broken`), kein stilles Ignorieren. */
export function decode(raw: Uint8Array | string): Decoded {
  let value: unknown;
  try {
    value = JSON.parse(typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8"));
  } catch {
    return { ok: false, reason: "kein gültiges JSON" };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { ok: false, reason: "kein JSON-Objekt" };
  const v = (value as { v?: unknown }).v;
  if (v !== 1) return { ok: false, reason: `Protokollversion v=${String(v)} statt 1` };
  return { ok: true, value: value as Record<string, unknown> };
}

export const str = (x: unknown, max = 200): string | undefined => (typeof x === "string" ? (x.length > max ? `${x.slice(0, max - 1)}…` : x) : undefined);
export const int = (x: unknown): number | undefined => (typeof x === "number" && Number.isInteger(x) && x >= 0 ? x : undefined);
const compact = <T extends Record<string, unknown>>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

export function infoPayload(m: Record<string, unknown>) {
  return compact({
    loop: "aspark-factory",
    line: str(m.line, 60),
    repo: str(m.repo, 120),
    mode: str(m.mode, 20),
    status: str(m.status, 20),
    activity: str(m.activity, 20),
    commands: Array.isArray(m.commands) ? m.commands.filter((c): c is string => typeof c === "string").slice(0, 20) : undefined,
  });
}

export function progressPayload(m: Record<string, unknown>) {
  const g = typeof m.gate === "object" && m.gate !== null ? (m.gate as Record<string, unknown>) : null;
  return compact({
    done: int(m.tasksDone),
    total: int(m.tasksTotal),
    phase: str(m.phase, 40),
    step: str(m.step, 60),
    feature: str(m.feature, 100),
    issue: int(m.issue),
    title: str(m.title, 160),
    gate: g ? compact({ name: str(g.name, 20), state: str(g.state, 20), detail: str(g.detail, 160) }) : undefined,
  });
}

export function statePayload(session: string, m: Record<string, unknown>) {
  return compact({ session, state: str(m.state, 20), detail: str(m.detail, 200) });
}

export function statsPayload(m: Record<string, unknown>) {
  const features = Array.isArray(m.features) ? m.features : [];
  return {
    completed: int(m.featuresCompleted) ?? 0,
    inProgress: int(m.featuresInProgress) ?? 0,
    features: features.slice(0, 12).flatMap((f) => {
      if (typeof f !== "object" || f === null) return [];
      const o = f as Record<string, unknown>;
      return [compact({ feature: str(o.feature, 100), phase: str(o.phase, 20), done: int(o.tasksDone), total: int(o.tasksTotal) })];
    }),
  };
}

export type Answer = { id: string; decision: "allow" | "deny"; message?: string } | { id: string; choices: number[][]; notes: string[] };

export interface AskQuestion {
  header: string;
  question: string;
  multiSelect: boolean;
  options: { label: string; description?: string }[];
}

export function readQuestions(m: Record<string, unknown>): AskQuestion[] | null {
  if (!Array.isArray(m.questions)) return null;
  const out: AskQuestion[] = [];
  for (const q of m.questions) {
    if (typeof q !== "object" || q === null) return null;
    const o = q as Record<string, unknown>;
    if (typeof o.question !== "string" || !Array.isArray(o.options)) return null;
    const options = o.options.flatMap((x) => (typeof x === "object" && x !== null && typeof (x as { label?: unknown }).label === "string" ? [x as { label: string; description?: string }] : []));
    out.push({ header: typeof o.header === "string" ? o.header : "", question: o.question, multiSelect: o.multiSelect === true, options });
  }
  return out;
}

/**
 * Antworten des Hubs (Fragetext → Label, Mehrfachwahl mit „, “) auf die Indizes des Protokolls abbilden.
 * Ein Text, der kein Label ist, wandert als Notiz zur Frage (das Protokoll erlaubt „nur Notiz“).
 */
export function answerQuestions(id: string, questions: readonly AskQuestion[], given: Record<string, unknown>): Answer {
  const choices: number[][] = [];
  const notes: string[] = [];
  for (const q of questions) {
    const text = typeof given[q.question] === "string" ? (given[q.question] as string) : "";
    const wanted = q.multiSelect ? text.split(", ").filter(Boolean) : text ? [text] : [];
    const picked = wanted.map((w) => q.options.findIndex((o) => o.label === w));
    const known = picked.every((i) => i >= 0);
    choices.push(known ? picked : []);
    notes.push(known ? "" : text);
  }
  return { id, choices, notes };
}
