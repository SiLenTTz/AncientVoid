import type { ListPage } from "../../app/route.ts";

/**
 * EPIC-P43 T43.6: Schnellsuche im Befehlsfeld — Springen zu Sessions, Projekten, Dateien, Werkzeugen und
 * Befehlen. Kein eigener Index: Sessions und Projekte sind die Listen, die die App ohnehin lädt; „Dateien“
 * ist die bestehende Codesuche der offenen Session. Reine Funktion, damit Reihenfolge und Treffer testbar sind.
 */
export type QuickKind = "session" | "projekt" | "datei" | "werkzeug" | "befehl";

export type QuickTarget =
  | { kind: "session"; sessionId: string; hostId: string | null }
  | { kind: "projekt"; path: string }
  | { kind: "datei"; sessionId: string; hostId: string | null; text: string }
  | { kind: "werkzeug"; page: ListPage }
  | { kind: "befehl"; text: string };

export interface QuickItem {
  kind: QuickKind;
  label: string;
  detail: string;
  target: QuickTarget;
}

export interface QuickSources {
  sessions: readonly { id: string; title?: string | null; project: string; hostId?: string | null; archived?: boolean }[];
  projects: readonly { path: string; name: string }[];
  /** Die gerade offene Session — nur dann gibt es den Sprung in ihre Dateien. */
  here: { sessionId: string; hostId: string | null } | null;
}

export const QUICK_KIND_LABEL: Record<QuickKind, string> = { session: "Session", projekt: "Projekt", datei: "Dateien", werkzeug: "Werkzeug", befehl: "Befehl" };

export const TOOLS: readonly { page: ListPage; label: string }[] = [
  { page: "dashboard", label: "Start" },
  { page: "new", label: "Neue Session" },
  { page: "approvals", label: "Freigaben" },
  { page: "orchestrierung", label: "Runs" },
  { page: "discovery", label: "Entdeckt" },
  { page: "media", label: "Medien" },
  { page: "vault", label: "Notizen" },
  { page: "automationen", label: "Automationen" },
  { page: "settings", label: "Einstellungen" },
  { page: "status", label: "Provider-Status" },
  { page: "pc", label: "PC" },
];

export const COMMANDS: readonly string[] = ["Zeig wartende Sessions", "Starte Codex in Projekt …: …", "Antworte dort: …", "Korrigiere den Text"];

const PER_KIND = 5;
const base = (path: string) => path.split("/").filter(Boolean).pop() ?? path;
const norm = (s: string) => s.toLocaleLowerCase("de-DE");

/** Rang eines Treffers: Wortanfang vor Teilstring; -1 = kein Treffer. */
function rank(hay: string, q: string): number {
  const h = norm(hay);
  const i = h.indexOf(q);
  if (i < 0) return -1;
  return i === 0 ? 0 : /[\s/·:._-]/.test(h[i - 1] ?? "") ? 1 : 2;
}

export function quickMatches(query: string, src: QuickSources): QuickItem[] {
  const q = norm(query.trim());
  if (!q) return [];
  const pick = <T>(list: readonly T[], text: (x: T) => string, item: (x: T) => QuickItem): QuickItem[] =>
    list
      .map((x, order) => ({ x, order, r: rank(text(x), q) }))
      .filter((m) => m.r >= 0)
      .sort((a, b) => a.r - b.r || a.order - b.order)
      .slice(0, PER_KIND)
      .map((m) => item(m.x));

  const sessions = pick(
    src.sessions.filter((s) => !s.archived),
    (s) => `${s.title ?? ""} ${base(s.project)}`,
    (s) => ({ kind: "session", label: s.title ?? base(s.project), detail: base(s.project), target: { kind: "session", sessionId: s.id, hostId: s.hostId ?? null } }),
  );
  const projects = pick(
    src.projects,
    (p) => p.name,
    (p) => ({ kind: "projekt", label: p.name, detail: "Neue Session hier", target: { kind: "projekt", path: p.path } }),
  );
  const files: QuickItem[] =
    src.here && q.length >= 2
      ? [{ kind: "datei", label: `„${query.trim()}“ in den Dateien suchen`, detail: "offene Session", target: { kind: "datei", sessionId: src.here.sessionId, hostId: src.here.hostId, text: query.trim() } }]
      : [];
  const tools = pick(TOOLS, (t) => t.label, (t) => ({ kind: "werkzeug", label: t.label, detail: "öffnen", target: { kind: "werkzeug", page: t.page } }));
  const commands = pick(COMMANDS, (c) => c, (c) => ({ kind: "befehl", label: c, detail: "als Auftrag eintragen", target: { kind: "befehl", text: c.replace(/…/g, "").replace(/: $/, ": ") } }));
  return [...sessions, ...projects, ...files, ...tools, ...commands];
}
