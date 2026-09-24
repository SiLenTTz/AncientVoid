/**
 * T9.2 / ADR-0027: the deterministic half of the planner — German and
 * English phrasings of the catalog, no model needed. It extracts an
 * intent with *names* (never IDs); the resolver turns names into targets
 * or asks back. Anything it does not know is left to the model (or
 * answered "nicht verstanden").
 */

export interface Intent {
  op: string;
  slots: Partial<Record<"session" | "project" | "host" | "adapter" | "text" | "amount" | "page" | "filter" | "field" | "transform" | "action" | "on", string>>;
}

export type ParseResult = { kind: "intent"; intent: Intent } | { kind: "refusal"; reason: string } | { kind: "none" };

const ADAPTERS: Record<string, string> = {
  claude: "claude",
  "claude code": "claude",
  codex: "codex",
  opencode: "opencode",
  "open code": "opencode",
  copilot: "copilot",
  aider: "aider",
  dsh: "acp",
  deepseek: "acp",
  dummy: "dummy",
};

const PAGE_WORDS: [RegExp, string][] = [
  [/\b(einstellungen|settings|konfiguration)\b/, "settings"],
  [/\b(status|provider-?status|kontingent|quota)\b/, "status"],
  [/\b(freigaben|approvals?|warteschlange)\b/, "approvals"],
  [/\b(gefunden\w*|discovery|externe sessions)\b/, "discovery"],
  [/\b(uebersicht|uebersicht|overview|startseite|home|dashboard)\b/, "dashboard"],
];

/** What follows ":" or a quote — kept verbatim (case, punctuation). */
function payload(raw: string): string | null {
  const quoted = /[„"“'‚‘«»]([^„"“”'‚‘’«»]{1,2000})[“”"'’«»]/.exec(raw);
  if (quoted?.[1]) return quoted[1].trim();
  const colon = raw.indexOf(":");
  if (colon >= 0 && colon < raw.length - 1) return raw.slice(colon + 1).trim();
  return null;
}

/** Lower case, umlauts spelled out — JS `\b` does not see ä/ö/ü as letters. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/\s+/g, " ")
    .trim();
}

/** "nicht stoppen", "don't stop", "kein Stopp" — a negated verb is no order. */
const NEGATED = /\b(nicht|nie|niemals|kein|keine|don'?t|do not|never|not)\b/;

function afterWord(t: string, words: RegExp): string | null {
  const m = words.exec(t);
  if (!m) return null;
  const rest = t.slice(m.index + m[0].length).replace(/^[\s:,-]+/, "").replace(/\s*(bitte|please)\s*$/, "").trim();
  return rest || null;
}

function sessionRef(t: string): string | null {
  // "die session X", "session X", "in X"; context words stay for the resolver.
  const m = /\b(?:session|sitzung)\s+(?:von\s+|zu\s+|fuer\s+|namens\s+|called\s+|named\s+)?["„“]?([\w aeoeuess./-]{2,60})/.exec(t);
  if (m?.[1]) return m[1].replace(/\b(stoppen|beenden|archivieren|anheften|oeffnen|an|ab)\b.*$/, "").trim() || null;
  const before = /\b(?:the|die|der|den|dem)\s+([\w.-]{2,40}(?:\s[\w.-]{2,40})?)[-\s](?:session|sitzung)\b/.exec(t);
  if (before?.[1] && !/^(ganze|aktuelle|current|laufende)$/.test(before[1])) return before[1];
  if (/\b(dort|da|hier|diese|dieser|this|there|it|ihr|ihm)\b/.test(t)) return "@context";
  return null;
}

export function parseCommand(raw: string): ParseResult {
  const text = raw.trim();
  if (!text) return { kind: "none" };
  const t = norm(text);
  const quoted = payload(text);

  // --- Things only a person's tap may do (AC-P9-1) ---------------------------
  if (/\b(gib|gebe)\b.*\bfrei\b|\b(erlaube|genehmige|approve|allow|lehne|reject|deny)\b/.test(t) && /\b(frei|freigabe|anfrage|request|tool|werkzeug|approval|erlaube|approve|allow|lehne|reject|deny)\b/.test(t)) {
    return { kind: "refusal", reason: "Freigaben entscheidest du selbst auf der Karte — ein Text-Auftrag ersetzt die Kontrolle nicht." };
  }
  if (/\b(token|passkey|schluessel|api-?key|passwort|password|einladungscode)\b/.test(t) && !/\bcode\b.*\bsuch/.test(t)) {
    return { kind: "refusal", reason: "Zugangsdaten und Schlüssel gehen nie durch das Modell — bitte in den Einstellungen selbst eintragen." };
  }

  // --- Field edits before commands: "schreibe 'stopp' in die Nachricht" -------
  const intoField = /\b(in|ins|into|to)\s+(die\s+|das\s+|den\s+|the\s+)?(nachricht|antwort\w*|feld|eingabe\w*|textfeld|message|field|box|prompt)\b/.test(t) || /\b(trag|trage)\b.*\bein\b/.test(t);
  if (intoField && /\b(schreib\w*|trag\w*|fuell\w*|setz\w*|write|type|put|fill)\b/.test(t)) {
    const txt = quoted ?? afterWord(text, /\b(schreib\w*|trag\w*|write|type|put)\b/i)?.replace(/\s*\b(in|ins)\s+(die|das|den)?\s*\w+\s*$/i, "") ?? null;
    if (!txt) return { kind: "refusal", reason: "Welcher Text soll ins Feld?" };
    const field = /\b(titel|name|title)\b/.test(t) ? "session_title" : /\b(suche|suchfeld|search)\b/.test(t) ? "code_query" : "reply";
    return { kind: "intent", intent: { op: "field.fill", slots: { field, text: txt } } };
  }

  // --- Text transforms on the current field ----------------------------------
  const transform: [RegExp, string][] = [
    [/\b(uebersetz\w*|translate)\b.*\b(englisch\w*|english|en)\b/, "translate_en"],
    [/\b(uebersetz\w*|translate)\b.*\b(deutsch\w*|german|de)\b/, "translate_de"],
    [/\b(korrigier\w*|rechtschreibung|tippfehler|correct|fix (the )?(spelling|typos))\b/, "correct"],
    [/\b(kuerz\w*|kuerzer|shorten|make (it )?shorter|kurz fassen)\b/, "shorten"],
    [/\b(verbesser\w*|umformulier\w*|improve|rewrite|polish)\b/, "improve"],
  ];
  for (const [re, kind] of transform) {
    // Only the instruction before a ":" — "…: README kürzen" is a prompt.
    const head = t.split(":")[0]!;
    if (re.test(head) && !/\b(session|sitzung|starte?\w*|start|launch)\b/.test(head)) return { kind: "intent", intent: { op: "field.transform", slots: { transform: kind } } };
  }

  // --- Navigation / lists ---------------------------------------------------
  if (/\b(wartend\w*|waiting|braucht mich|brauchen mich|auf mich wartet|wartet auf mich|waits for me|needs me|offen\w* anfragen|pending)\b/.test(t) && /\b(zeig\w*|liste\w*|show|list|welche|which|was|what)\b/.test(t)) {
    return { kind: "intent", intent: { op: "sessions.show", slots: { filter: "waiting" } } };
  }
  if (/\b(aktiv\w*|laufend\w*|running|active)\b/.test(t) && /\b(sessions?|sitzungen)\b/.test(t) && /\b(zeig\w*|liste\w*|show|list|welche|which)\b/.test(t)) {
    return { kind: "intent", intent: { op: "sessions.show", slots: { filter: "active" } } };
  }
  if (/\b(alle|all|letzte\w*|recent)\b/.test(t) && /\b(sessions?|sitzungen)\b/.test(t) && /\b(zeig\w*|liste\w*|show|list)\b/.test(t)) {
    return { kind: "intent", intent: { op: "sessions.show", slots: { filter: /letzte|recent/.test(t) ? "recent" : "all" } } };
  }

  // --- Code search -----------------------------------------------------------
  const code = /\b(?:such\w*|find\w*|search|wo ist|where is)\b(?:\s+(?:im|in the|in)\s+code)?\s+(?:nach\s+|for\s+)?(?:der\s+|die\s+|dem\s+|the\s+)?(?:funktion\s+|function\s+|klasse\s+|class\s+|methode\s+|method\s+)?[„"“']?([A-Za-z_$][\w$.]{1,80})[“”"']?(?:\s+(?:im|in the|in)\s+code)?/i.exec(text);
  if (code?.[1] && (/\bcode\b|\bfunktion|\bfunction|\bklasse|\bclass|\bmethode|\bmethod|wo ist|where is/i.test(text))) {
    return { kind: "intent", intent: { op: "code.search", slots: { text: code[1], ...(sessionRef(t) && sessionRef(t) !== "@context" ? { session: sessionRef(t)! } : {}) } } };
  }

  // --- Start a session -------------------------------------------------------
  const start = /\b(starte?\w*|beginn\w*|leg\w* .* an|neue session|new session|start|launch|kick off)\b/.test(t);
  const adapterWord = Object.keys(ADAPTERS).sort((a, b) => b.length - a.length).find((a) => new RegExp(`\\b${a}\\b`).test(t));
  if (start && (adapterWord || /\b(projekt|project|in|im|on)\s+[\w.-]{2}/.test(t.split(":")[0]!)) && !NEGATED.test(t.split(":")[0]!)) {
    const proj = /\b(?:im projekt|in projekt|projekt|project|in|im|fuer|for|on)\s+["„“]?([\w.-]{2,60})/.exec(t.split(":")[0]!.replace(new RegExp(`\\b${adapterWord ?? "@@"}\\b`, "g"), " "));
    const host = /\b(?:auf|on|at)\s+(?:dem\s+|der\s+|host\s+|rechner\s+)?([\w-]{2,40})/.exec(t.split(":")[0]!);
    const slots: Intent["slots"] = {};
    if (adapterWord) slots.adapter = ADAPTERS[adapterWord]!;
    if (proj?.[1] && !Object.keys(ADAPTERS).includes(proj[1]) && proj[1] !== "session") slots.project = proj[1];
    if (host?.[1] && host[1] !== proj?.[1]) slots.host = host[1];
    const p = payload(text);
    if (p) slots.text = p;
    return { kind: "intent", intent: { op: "session.create", slots } };
  }

  // --- Answer / send ---------------------------------------------------------
  // Imperatives only ("sagt der Agent?" is a question, not an order), and a
  // question without ":"/quotes sends nothing (AC-P9-4).
  if (/\b(antworte|antwort|schreib|schreibe|sag|sage|schick|schicke|send|sende|reply|answer|tell|say|frag|frage)\b/.test(t) && !/\bneue session\b/.test(t)) {
    if (!quoted && /\?\s*$/.test(text)) return { kind: "none" };
    const txt = quoted ?? afterWord(text, /\b(antworte\w*|sag\w*|reply|answer|tell|say|schreib\w*|schick\w*|send\w*)\b(\s+(ihr|ihm|dort|da|der session|claude|codex|it|them|there))?/i);
    if (!txt) return { kind: "refusal", reason: "Was soll gesendet werden? Bitte „Antworte: …“." };
    const target = sessionRef(t.split(":")[0]!);
    return { kind: "intent", intent: { op: "session.prompt", slots: { text: txt, ...(target ? { session: target } : {}) } } };
  }

  // --- Lifecycle -------------------------------------------------------------
  if (/\b(stopp\w*|beend\w*|stop|kill|abbrech\w*|terminate|end)\b/.test(t)) {
    if (NEGATED.test(t)) return { kind: "none" };
    const target = sessionRef(t) ?? afterWord(t, /\b(stoppe|stopp|beende|stop|kill)\b/)?.replace(/\b(die|den|das|the|session|sitzung)\b/g, "").trim();
    return { kind: "intent", intent: { op: "session.stop", slots: target ? { session: target } : {} } };
  }
  if (/\bhalt\w*\b.*\ban\b|\b(pausier\w*|unterbrech\w*|unterbrich\w*|interrupt|pause)\b/.test(t)) {
    if (NEGATED.test(t)) return { kind: "none" };
    const target = sessionRef(t);
    return { kind: "intent", intent: { op: "session.park", slots: target ? { session: target } : {} } };
  }
  if (/\b(archivier\w*|archive)\b/.test(t)) {
    const target = sessionRef(t) ?? afterWord(t, /\b(archiviere|archive)\b/)?.replace(/\b(die|den|das|the|session|sitzung)\b/g, "").trim();
    return { kind: "intent", intent: { op: "session.archive", slots: { on: /zurück|wiederher|restore|unarchive/.test(t) ? "false" : "true", ...(target ? { session: target } : {}) } } };
  }
  if (/\b(heft\w*|pin\w*|anheften|loese|unpin|losheften)\b/.test(t)) {
    const target = sessionRef(t);
    return { kind: "intent", intent: { op: "session.pin", slots: { on: /\b(loese|unpin|losheften|loesen)\b/.test(t) ? "false" : "true", ...(target ? { session: target } : {}) } } };
  }
  const rename = /\b(?:benenn\w*|rename)\b.*?\b(?:um in|um zu|in|to|as)\s+["„“]?(.{2,80}?)["“”]?$/i.exec(text);
  if (rename?.[1]) {
    const target = sessionRef(t.replace(/\b(um in|um zu|to|as)\b.*$/, ""));
    return { kind: "intent", intent: { op: "session.rename", slots: { text: rename[1].trim(), ...(target ? { session: target } : {}) } } };
  }
  const budget = /budget\D{0,25}?(\d+(?:[.,]\d+)?)/.exec(t);
  if (budget?.[1]) {
    return { kind: "intent", intent: { op: "session.budget", slots: { amount: budget[1].replace(",", "."), ...(sessionRef(t) ? { session: sessionRef(t)! } : {}) } } };
  }
  if (/\b(uebernimm\w*|uebernehm\w*|merge|apply)\b/.test(t) && /\b(projekt|project|main|aenderung\w*|changes?)\b/.test(t)) {
    return { kind: "intent", intent: { op: "session.apply", slots: sessionRef(t) ? { session: sessionRef(t)! } : {} } };
  }
  if (/\b(test\w*)\b/.test(t) && /\b(fuehr\w*|lass\w*|starte?|run|execute)\b/.test(t)) {
    return { kind: "intent", intent: { op: "action.run", slots: { action: "test" } } };
  }
  const gitAction = /\bgit\s*(status|log|diff)\b/.exec(t);
  if (gitAction) return { kind: "intent", intent: { op: "action.run", slots: { action: gitAction[1] === "status" ? "git-status" : gitAction[1] === "log" ? "git-log" : "git-diff-stat" } } };

  // --- Open something --------------------------------------------------------
  for (const [re, page] of PAGE_WORDS) {
    if (re.test(t) && /\b(zeig\w*|oeffn\w*|geh\w*|wechsel\w*|zurueck|wie ist|wie steht|was ist|show|open|go|back|how is|what is)\b|^\S+$/.test(t)) return { kind: "intent", intent: { op: "nav.open", slots: { page } } };
  }
  if (/\b(neue session|new session)\b/.test(t)) return { kind: "intent", intent: { op: "nav.open", slots: { page: "new" } } };
  const open = afterWord(t, /\b(oeffne|oeffnen|zeig mir|zeige mir|zeig|zeige|geh zu|gehe zu|wechsle zu|open|show me|show|go to)\b/);
  if (open) return { kind: "intent", intent: { op: "session.open", slots: { session: open.replace(/\b(die|den|das|the|session|sitzung|projekt|project)\b/g, "").trim() || "@context" } } };

  return { kind: "none" };
}
