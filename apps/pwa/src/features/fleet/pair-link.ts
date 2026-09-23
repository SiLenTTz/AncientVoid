/**
 * AI-P6-2: what the invite QR carries — the inviting hub's address and the
 * one-time code, so the home hub's PWA fills both fields from one scan.
 * Format: `<hub origin>/#/pair?code=<CODE>`.
 */
export function pairLink(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, "")}/#/pair?code=${encodeURIComponent(code)}`;
}

export function parsePairLink(text: string): { url: string; code: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(text.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const match = /^#\/pair\?code=([^&]+)$/.exec(parsed.hash);
  if (!match?.[1]) return null;
  return { url: parsed.origin, code: decodeURIComponent(match[1]) };
}
