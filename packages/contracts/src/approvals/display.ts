/**
 * ADR-0048: a display (e.g. VoidWarden's ESP32 terminal) shows the hub's state
 * and may decide `write` approvals by touch — nothing else. Its token label is
 * `display:<name>`; the routes below are the only ones it reaches.
 */
export const DISPLAY_TOKEN_PREFIX = "display:";

const READ_ROUTES = [
  /^\/api\/(health|ready|notifications|approvals|sessions)$/,
  /^\/api\/(approvals|sessions)\/[^/]+$/,
];
const DECIDE_ROUTE = /^\/api\/approvals\/[^/]+\/decide$/;

export function displayTokenAllows(method: string, path: string): boolean {
  if (method === "GET" || method === "HEAD") return READ_ROUTES.some((re) => re.test(path));
  return method === "POST" && DECIDE_ROUTE.test(path);
}

/**
 * ADR-0066: eine je Token vergebene Fähigkeit. Ein Display mit ihr darf eine
 * Provider-Rückfrage beantworten — aber nur mit einer Option, die der Agent
 * selbst vorgegeben hat. Am Display entsteht nie Text, der den Agenten erreicht.
 */
export const DISPLAY_ANSWER_CAPABILITY = "display.answer_questions";
export const TOKEN_CAPABILITIES: readonly string[] = [DISPLAY_ANSWER_CAPABILITY];

interface OptionQuestion {
  question: string;
  labels: string[];
}

/** Nur Fragen, die ausschließlich über vorgegebene Optionen beantwortbar sind; sonst null. */
function optionQuestions(questions: unknown): OptionQuestion[] | null {
  if (!Array.isArray(questions) || questions.length === 0) return null;
  const out: OptionQuestion[] = [];
  for (const raw of questions) {
    if (typeof raw !== "object" || raw === null) return null;
    const q = raw as { question?: unknown; options?: unknown; multiSelect?: unknown };
    if (typeof q.question !== "string" || q.question.length === 0 || q.multiSelect === true) return null;
    if (!Array.isArray(q.options) || q.options.length < 2) return null;
    const labels: string[] = [];
    for (const o of q.options) {
      const label = typeof o === "object" && o !== null ? (o as { label?: unknown }).label : undefined;
      if (typeof label !== "string" || label.length === 0 || labels.includes(label)) return null;
      labels.push(label);
    }
    // Antworten sind nach Fragetext geschlüsselt — doppelte Texte wären mehrdeutig.
    if (out.some((x) => x.question === q.question)) return null;
    out.push({ question: q.question, labels });
  }
  return out;
}

/** Darf ein Display mit diesen Fähigkeiten diese Anfrage beantworten? (ADR-0066) */
export function displayAnswerable(request: { action: string; class: string; reasonRequired: boolean; status?: string }, questions: unknown, capabilities: readonly string[]): boolean {
  if (!capabilities.includes(DISPLAY_ANSWER_CAPABILITY)) return false;
  if (request.action !== "tool.question" || request.class !== "write" || request.reasonRequired) return false;
  if (request.status !== undefined && request.status !== "pending") return false;
  return optionQuestions(questions) !== null;
}

/** Genau eine vorgegebene Option je Frage, wortgleich — kein Freitext, nichts Fehlendes, nichts Fremdes. */
export function displayAnswersValid(questions: unknown, answers: Record<string, string> | undefined): boolean {
  const qs = optionQuestions(questions);
  if (qs === null || answers === undefined) return false;
  const keys = Object.keys(answers);
  if (keys.length !== qs.length) return false;
  return qs.every((q) => Object.hasOwn(answers, q.question) && q.labels.includes(answers[q.question]!));
}
