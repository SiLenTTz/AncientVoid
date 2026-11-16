import type { NormalizedEvent } from "@ancientvoid/contracts";

/** K5: the prompt travels as a user event — it must stay under the 4 KB payload limit. */
export const HANDOVER_PROMPT_MAX = 3500;

export interface HandoverContext {
  adapter: string;
  model: string | null;
  /** The provider.error that stopped the run, when there is one. */
  reason?: { title: string; detail: string } | undefined;
}

const SECRETS: RegExp[] = [
  /\b(?:sk|pk|ghp|gho|glpat|xox[abp])[-_][A-Za-z0-9_-]{16,}/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,
  /\b[A-Fa-f0-9]{40,}\b/g,
  /\b(api[_-]?key|token|secret|password|passwort)(\s*[=:]\s*)\S{8,}/gi,
];

/** Nothing that looks like a key leaves this hub inside a handover text. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const re of SECRETS) out = out.replace(re, (m, name, sep) => (typeof name === "string" && typeof sep === "string" ? `${name}${sep}[entfernt]` : "[entfernt]"));
  return out;
}

const clip = (text: string, max: number): string => {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

const textOf = (e: NormalizedEvent): string => {
  const t = (e.payload as { text?: unknown }).text;
  return typeof t === "string" && t ? t : e.summary;
};

/**
 * EPIC-P21 T21.2: what the next provider needs to carry on — the task, where it stood, what ran.
 * Derived from the event stream only; the working directory holds the actual changes.
 */
export function buildHandoverPrompt(events: readonly NormalizedEvent[], ctx: HandoverContext): string {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  const prompts = sorted.filter((e) => e.type === "user" && (e.payload as { kind?: unknown }).kind === "session.prompt");
  const task = prompts[0];
  const lastPrompt = prompts.length > 1 ? prompts.at(-1) : undefined;
  const answers = sorted.filter((e) => e.type === "assistant").slice(-3);
  const tools = new Map<string, number>();
  for (const e of sorted) {
    if (e.type !== "tool_use") continue;
    const name = String((e.payload as { name?: unknown }).name ?? e.summary.split("(")[0] ?? "Werkzeug");
    tools.set(name, (tools.get(name) ?? 0) + 1);
  }
  const lines = [
    `Übergabe: Diese Arbeit lief bisher mit ${ctx.adapter}${ctx.model ? ` (${ctx.model})` : ""} und wird bei dir fortgesetzt.`,
    ...(ctx.reason ? [`Grund: ${ctx.reason.title}. ${clip(ctx.reason.detail, 200)}`] : []),
    "",
    "Ursprünglicher Auftrag:",
    task ? clip(textOf(task), 1000) : "(nicht im Verlauf)",
    ...(lastPrompt ? ["", "Letzte Eingabe:", clip(textOf(lastPrompt), 600)] : []),
    ...(answers.length > 0 ? ["", "Zuletzt gesagt:", ...answers.map((e) => `- ${clip(textOf(e), 300)}`)] : []),
    ...(tools.size > 0 ? ["", `Werkzeuge bisher: ${[...tools].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n, c]) => `${n} ×${c}`).join(", ")}`] : []),
    "",
    "Das Arbeitsverzeichnis enthält schon die bisherigen Änderungen. Prüfe zuerst `git status` und `git diff`, wiederhole nichts Erledigtes und mache dort weiter, wo es aufgehört hat.",
  ];
  const text = redactSecrets(lines.join("\n"));
  return text.length > HANDOVER_PROMPT_MAX ? `${text.slice(0, HANDOVER_PROMPT_MAX - 1)}…` : text;
}
