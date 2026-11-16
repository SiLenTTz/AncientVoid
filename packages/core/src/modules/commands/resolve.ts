import { COMMANDS, type CommandContext, type CommandId, type PlanQuestion, type PlanStep } from "@ancientvoid/contracts";
import type { Intent } from "./parse.ts";

/** What the resolver may look at — IDs, names, states; never event text. */
export interface ResolveData {
  selfHost: string;
  sessions: { id: string; hostId: string; title: string | null; project: string; adapter: string; status: string; inputRevision: number; archived: boolean }[];
  projects: { hostId: string; path: string }[];
  adapters: { hostId: string; id: string }[];
  actions?: { id: string; label: string; kind: string }[];
}

export type Resolved = { steps: PlanStep[]; question: PlanQuestion | null; refusal: string | null };

const base = (p: string) => p.split("/").filter(Boolean).pop() ?? p;
const n = (s: string) =>
  s
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const STOP = new Set(["die", "der", "das", "den", "dem", "the", "a", "an", "session", "sitzung", "in", "im", "von", "mit", "on", "auf", "fuer", "for", "bitte", "please", "projekt", "project"]);

function sessionLabel(s: ResolveData["sessions"][number]): string {
  return `${s.title ?? base(s.project)} · ${s.hostId} · ${base(s.project)} · ${s.adapter}`;
}

/** Best matching sessions for a spoken name (ties are returned together). */
export function matchSessions(name: string, sessions: ResolveData["sessions"]): ResolveData["sessions"] {
  const words = n(name).split(" ").filter((w) => w.length > 1 && !STOP.has(w));
  if (words.length === 0) return [];
  const scored = sessions
    .filter((s) => !s.archived)
    .map((s) => {
      const hay = n(`${s.title ?? ""} ${base(s.project)} ${s.adapter} ${s.hostId}`);
      const title = n(s.title ?? "");
      let score = 0;
      for (const w of words) if (new RegExp(`\\b${w}`).test(hay)) score += 1;
      if (title && title === n(name)) score += 10;
      return { s, score };
    })
    .filter((x) => x.score > 0);
  const best = Math.max(0, ...scored.map((x) => x.score));
  // Every word must match somewhere for a confident hit.
  const full = scored.filter((x) => x.score === best && best >= words.length);
  return (full.length ? full : scored.filter((x) => x.score === best)).map((x) => x.s);
}

function question(param: string, q: string, options: { value: string; label: string }[]): Resolved {
  return { steps: [], question: { param, question: q, options: options.slice(0, 12) }, refusal: null };
}

function pickOptions(sessions: ResolveData["sessions"]): { value: string; label: string }[] {
  const rank = (st: string) => (st === "waiting_approval" ? 0 : st === "working" || st === "idle" ? 1 : 2);
  return [...sessions].sort((a, b) => rank(a.status) - rank(b.status)).map((s) => ({ value: `${s.hostId}|${s.id}`, label: sessionLabel(s) }));
}

/**
 * Names → targets. `answers` carries what the person picked for an earlier
 * question (param → value), so asking twice for the same thing never happens.
 */
export function resolveIntent(intent: Intent, ctx: CommandContext, data: ResolveData, answers: Record<string, string> = {}): Resolved {
  const spec = COMMANDS[intent.op as CommandId];
  if (!spec) return { steps: [], question: null, refusal: `Unbekannter Auftrag „${intent.op}“.` };
  const args: PlanStep["args"] = {};
  let target: string | null = null;
  const slots = intent.slots;

  // --- session ---
  if ("session" in spec.params) {
    let chosen: ResolveData["sessions"][number] | undefined;
    const answered = answers.session;
    if (answered) {
      const [hostId, id] = answered.split("|");
      chosen = data.sessions.find((s) => s.id === id && s.hostId === hostId);
      if (!chosen) return { steps: [], question: null, refusal: "Diese Session gibt es nicht (mehr)." };
    } else if (!slots.session || slots.session === "@context") {
      if (ctx.sessionId) chosen = data.sessions.find((s) => s.id === ctx.sessionId && s.hostId === (ctx.hostId ?? data.selfHost));
      if (!chosen) {
        const live = data.sessions.filter((s) => !s.archived && s.status !== "stopped");
        if (live.length === 1) return question("session", `Meinst du „${sessionLabel(live[0]!)}“?`, pickOptions(live));
        return question("session", "Welche Session?", pickOptions(live.length ? live : data.sessions.filter((s) => !s.archived)));
      }
    } else {
      const hits = matchSessions(slots.session, data.sessions);
      if (hits.length === 0) return question("session", `Keine Session passt zu „${slots.session}“. Welche meinst du?`, pickOptions(data.sessions.filter((s) => !s.archived)));
      if (hits.length > 1) return question("session", `Mehrere Sessions passen zu „${slots.session}“ — welche?`, pickOptions(hits));
      chosen = hits[0]!;
    }
    args.sessionId = chosen.id;
    args.hostId = chosen.hostId;
    args.revision = chosen.inputRevision;
    target = sessionLabel(chosen);
    if (intent.op === "session.prompt" && chosen.status === "stopped") args.resume = true;
  }

  // --- project / host / adapter (start) ---
  if (intent.op === "session.create") {
    let host = answers.host ?? (slots.host ? data.adapters.map((a) => a.hostId).find((h) => n(h) === n(slots.host!) || n(h).startsWith(n(slots.host!))) : undefined);
    if (slots.host && !host) return question("host", `Den Host „${slots.host}“ kenne ich nicht. Welcher?`, [...new Set(data.adapters.map((a) => a.hostId))].map((h) => ({ value: h, label: h })));
    const projectName = answers.project ?? slots.project;
    let project: ResolveData["projects"][number] | undefined;
    if (answers.project?.includes("|")) {
      const [h, path] = answers.project.split("|");
      project = data.projects.find((p) => p.hostId === h && p.path === path);
    } else if (projectName) {
      const hits = data.projects.filter((p) => (!host || p.hostId === host) && (n(base(p.path)) === n(projectName) || n(base(p.path)).includes(n(projectName))));
      const exact = hits.filter((p) => n(base(p.path)) === n(projectName));
      const pool = exact.length ? exact : hits;
      if (pool.length === 0) return question("project", `Kein Projekt „${projectName}“${host ? ` auf ${host}` : ""}. Welches?`, data.projects.filter((p) => !host || p.hostId === host).map((p) => ({ value: `${p.hostId}|${p.path}`, label: `${base(p.path)} · ${p.hostId}` })));
      if (pool.length > 1) return question("project", `„${projectName}“ gibt es mehrfach — welches?`, pool.map((p) => ({ value: `${p.hostId}|${p.path}`, label: `${base(p.path)} · ${p.hostId}` })));
      project = pool[0];
    } else {
      return question("project", "In welchem Projekt?", data.projects.filter((p) => !host || p.hostId === host).map((p) => ({ value: `${p.hostId}|${p.path}`, label: `${base(p.path)} · ${p.hostId}` })));
    }
    if (!project) return { steps: [], question: null, refusal: "Dieses Projekt gibt es nicht (mehr)." };
    host = project.hostId;
    const adapter = answers.adapter ?? slots.adapter;
    const onHost = data.adapters.filter((a) => a.hostId === host).map((a) => a.id);
    if (!adapter || !onHost.includes(adapter)) {
      return question("adapter", adapter ? `${adapter} gibt es auf ${host} nicht — welcher Harness?` : "Mit welchem Harness?", onHost.map((a) => ({ value: a, label: a })));
    }
    args.hostId = host;
    args.project = project.path;
    args.adapter = adapter;
    if (slots.text) args.text = slots.text;
    target = `${adapter} · ${base(project.path)} · ${host}`;
  }

  // --- simple slots ---
  if (spec.params && "text" in spec.params && intent.op !== "session.create") {
    if (!slots.text && !(spec.params.text as { optional?: boolean }).optional) return { steps: [], question: null, refusal: "Welcher Text?" };
    if (slots.text) args.text = slots.text;
  }
  if ("amount" in spec.params) {
    const amount = Number(slots.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000) return { steps: [], question: null, refusal: "Welcher Betrag (in Dollar)?" };
    args.amount = amount;
  }
  if ("page" in spec.params) {
    args.page = slots.page ?? "dashboard";
    target = null;
  }
  if ("filter" in spec.params) args.filter = slots.filter ?? "all";
  if ("on" in spec.params) args.on = slots.on !== "false";
  if ("transform" in spec.params) {
    if (!ctx.field || !ctx.fieldText) return { steps: [], question: null, refusal: "Tippe zuerst in ein Feld — dann kann ich den Text bearbeiten." };
    args.transform = slots.transform ?? "improve";
    args.field = ctx.field;
    target = `Feld „${ctx.field}“`;
  }
  if (intent.op === "field.fill") {
    args.field = slots.field ?? ctx.field ?? "reply";
    target = `Feld „${args.field}“`;
  }
  if (intent.op === "code.search" && !args.sessionId) return { steps: [], question: null, refusal: "In welcher Session suchen? Öffne sie zuerst." };
  if ("action" in spec.params) {
    const wanted = answers.action ?? slots.action ?? "";
    const actions = data.actions ?? [];
    const hit = wanted === "test" ? actions.find((a) => a.kind === "test") : actions.find((a) => a.id === wanted);
    if (!hit) return question("action", "Welche Aktion?", actions.map((a) => ({ value: a.id, label: a.label })));
    args.action = hit.id;
    target = `${hit.label} · ${target ?? ""}`;
  }

  return {
    steps: [{ op: spec.id, args, target, risk: spec.risk, runner: spec.runner, summary: `${spec.label}${target ? ` — ${target}` : ""}${typeof args.text === "string" && intent.op !== "code.search" ? `: „${String(args.text).slice(0, 80)}“` : ""}` }],
    question: null,
    refusal: null,
  };
}

