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

export function classifyProviderError(raw: string, ref?: string): ProviderErrorInfo {
  const text = raw.trim();
  const refNote = ref ? ` Referenz: ${ref}.` : "";
  const usage = /usage limit reached(?: for (\d+) (hour|day|week|month))?/i.exec(text);
  if (usage) {
    const window = usage[1] ? `${usage[1]} ${usage[2]!.charAt(0).toLowerCase()}` : undefined;
    const resetAt = RESET_RE.exec(text)?.[1];
    return {
      category: "quota",
      title: `Kontingent erschöpft${window ? ` (${window})` : ""}`,
      detail: `${resetAt ? `Der Provider ist wieder frei ab ${resetAt} (Provider-Zeit).` : "Der Provider nennt keine Freigabezeit."} Danach mit „Weiter“ fortsetzen.${refNote}`,
      ...(resetAt ? { resetAt } : {}),
      ...(window ? { window } : {}),
    };
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

/** The one event every adapter emits for a provider failure. */
export function providerErrorEvent(provider: string, raw: string, ref?: string): EmittedEvent {
  const info = classifyProviderError(raw, ref);
  return {
    type: "system",
    summary: `${provider}: ${info.title}`,
    payload: { kind: "provider.error", provider, ...info, raw: raw.slice(0, 1000), ...(ref ? { ref } : {}) },
  };
}
