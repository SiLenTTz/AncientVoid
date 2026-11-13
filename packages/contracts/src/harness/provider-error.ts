import type { EmittedEvent } from "../sessions/event.ts";

/**
 * ADR-0015: provider failures in words a user can act on. Pure text
 * matching over what the CLI printed — no guessing beyond it: an opaque
 * error stays "server"/"unknown" and says so.
 */
export type ProviderErrorCategory = "quota" | "rate_limit" | "auth" | "network" | "server" | "unknown";

export interface ProviderErrorInfo {
  category: ProviderErrorCategory;
  title: string;
  detail: string;
  /** Reset moment as the provider wrote it (its own time zone). */
  resetAt?: string;
  /** Quota window as the provider named it, e.g. "5 h". */
  window?: string;
}

const RESET_RE = /reset at ([0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9:]{5,8})/i;
const CYCLE_RE = /ends on ([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4})/i;

function quotaInfo(text: string, refNote: string, window?: string): ProviderErrorInfo {
  const resetAt = RESET_RE.exec(text)?.[1] ?? CYCLE_RE.exec(text)?.[1];
  const named = /usage limit for ([A-Za-z0-9._-]+)/i.exec(text)?.[1]?.replace(/[._-]+$/, "");
  const label = window ?? named;
  return {
    category: "quota",
    title: `Kontingent erschöpft${label ? ` (${label})` : ""}`,
    detail: `${resetAt ? `Der Provider ist wieder frei ab ${resetAt} (Provider-Zeit).` : "Der Provider nennt keine Freigabezeit."} Danach mit „Weiter“ fortsetzen oder die Arbeit an eine andere Session übergeben.${refNote}`,
    ...(resetAt ? { resetAt } : {}),
    ...(window ? { window } : {}),
  };
}

export function classifyProviderError(raw: string, ref?: string): ProviderErrorInfo {
  const text = raw.trim();
  const refNote = ref ? ` Referenz: ${ref}.` : "";
  const usage = /usage limit reached(?: for (\d+) (hour|day|week|month))?/i.exec(text);
  if (usage) {
    const window = usage[1] ? `${usage[1]} ${usage[2]!.charAt(0).toLowerCase()}` : undefined;
    return quotaInfo(text, refNote, window);
  }
  // Cursor schreibt das Kontingent nicht als „usage limit reached“, sondern
  // als ActionRequiredError auf stdout („You've hit your usage limit for Opus“).
  if (/hit your usage limit|out of usage|ActionRequiredError/i.test(text)) {
    return quotaInfo(text, refNote);
  }
  if (/\b429\b|rate.?limit|too many requests/i.test(text)) {
    return { category: "rate_limit", title: "Rate-Limit des Providers", detail: `Zu viele Anfragen in kurzer Zeit. Kurz warten und erneut senden.${refNote}` };
  }
  if (/\b40[13]\b|unauthori[sz]ed|forbidden|invalid.*(api.?key|token)|authentication|not logged in|login required/i.test(text)) {
    return { category: "auth", title: "Anmeldung beim Provider fehlgeschlagen", detail: `Die CLI ist nicht (mehr) angemeldet oder der Schlüssel ist ungültig. Am PC neu anmelden.${refNote}` };
  }
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|network|socket hang up|could not connect|connection refused/i.test(text)) {
    return { category: "network", title: "Keine Verbindung zum Provider", detail: `Netzwerk oder DNS des Hubs prüfen, dann erneut senden.${refNote}` };
  }
  if (/unexpected server error|\b5\d\d\b|overloaded|internal server error|service unavailable|bad gateway/i.test(text)) {
    const opaque = /unexpected server error/i.test(text);
    return {
      category: "server",
      title: "Serverfehler beim Provider",
      detail: opaque
        ? `Die CLI meldet keine Ursache („${text.slice(0, 120)}“). Häufig: Kontingent oder Rate-Limit erreicht, oder eine Störung beim Provider. Später mit „Weiter“ erneut versuchen.${refNote}`
        : `Der Provider ist gestört oder überlastet („${text.slice(0, 120)}“). Später erneut versuchen.${refNote}`,
    };
  }
  return { category: "unknown", title: "Fehler beim Provider", detail: `${text.slice(0, 300) || "ohne Text"}${refNote}` };
}

export interface VisibleProviderFailure {
  category: ProviderErrorCategory | "session";
  title: string;
  detail: string;
}

/**
 * The failure the person can act on, including the legacy Cursor quota line
 * (BUG-0149) that predates provider.error. Walks one event; null if it is
 * not a failure.
 */
export function providerFailureOf(
  payload: { kind?: unknown; category?: unknown; title?: unknown; detail?: unknown; error?: unknown; cause?: unknown; line?: unknown },
  summary: string,
): VisibleProviderFailure | null {
  if (payload.kind === "provider.error") {
    const category = payload.category;
    return {
      category: category === "quota" || category === "rate_limit" || category === "auth" || category === "network" || category === "server" || category === "unknown" ? category : "unknown",
      title: String(payload.title ?? summary),
      detail: String(payload.detail ?? ""),
    };
  }
  if (payload.kind === "cursor.usage_limit") {
    const info = classifyProviderError(String(payload.line ?? summary));
    return { category: info.category === "unknown" ? "quota" : info.category, title: info.title, detail: info.detail };
  }
  if (payload.kind === "acp.context_lost") return { category: "session", title: "Agent hat den Verlauf verloren", detail: String(payload.cause ?? summary) };
  if (payload.kind === "session.start_failed" && /resource not found/i.test(String(payload.error ?? ""))) {
    return { category: "session", title: "Provider-Session verloren", detail: String(payload.error ?? "") };
  }
  return null;
}

/** Current-turn failure: stops at the latest prompt, handover or answer. */
export function currentProviderFailureFromEvents(
  events: readonly { type: string; summary: string; payload: { kind?: unknown; line?: unknown; category?: unknown; title?: unknown; detail?: unknown; error?: unknown; cause?: unknown } }[],
): VisibleProviderFailure | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!;
    const kind = event.payload.kind;
    if (kind === "session.prompt" || kind === "session.handover_out") return null;
    if (event.type === "assistant") return null;
    const failure = providerFailureOf(event.payload, event.summary);
    if (failure) return failure;
  }
  return null;
}

/** The one event every adapter emits for a provider failure. */
export function providerErrorEvent(provider: string, raw: string, ref?: string): EmittedEvent {
  const info = classifyProviderError(raw, ref);
  return {
    type: "system",
    summary: `${provider}: ${info.title}`,
    payload: { kind: "provider.error", provider, ...info, raw: raw.slice(0, 1000), ...(ref ? { ref } : {}) },
  };
}
