/**
 * AI-P9-2 (Web Share Target, Text-/URL-Anteil): Das Teilen-Menü einer
 * anderen App öffnet die installierte PWA als `/?title=…&text=…&url=…`
 * (manifest share_target, GET — bewusst ohne POST/Service-Worker-Pfad,
 * der im E2E-Gate nicht prüfbar wäre; Datei-Anteile bleiben
 * T12.4-Gerätetest-Rest). main.tsx fischt die Parameter einmalig beim
 * Start ab — vor dem Token-Gate, Teilen soll auch offline landen — und
 * CreateSession füllt den Auftrag vor (nie überschreiben: bestehender
 * Text bleibt, Geteiltes wird angehängt).
 */

/** Pure: builds the prefilled prompt from the share_target query. */
export function captureShareTarget(search: string): { text: string } | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const title = (params.get("title") ?? "").trim();
  const text = (params.get("text") ?? "").trim();
  const url = (params.get("url") ?? "").trim();
  // Sharing a bare link puts it in text *and* url — keep it once.
  const parts = [title, text, url === text ? "" : url].filter((p) => p.length > 0);
  return parts.length > 0 ? { text: parts.join("\n\n") } : null;
}

const KEY = "uacc.share.inbox";

export function storeShareInbox(text: string): void {
  try {
    sessionStorage.setItem(KEY, text);
  } catch {
    /* Private Mode etc. — Teilen ist Best-Effort, niemals ein Crash. */
  }
}

/** One-shot wie media.ts takeHandOver: liefert und löscht die Inbox. */
export function takeShareInbox(): string | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw !== null) sessionStorage.removeItem(KEY);
    return raw;
  } catch {
    return null;
  }
}
