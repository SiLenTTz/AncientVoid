/**
 * EPIC-P39 (ADR-0059 §3): Zielkontrolle des Browser-Arbeitsplatzes. Reine Funktionen, damit jede Regel testbar ist.
 * Automatisch erlaubt sind nur Loopback-IP-Literale mit dem Port eines registrierten Workspace-Services; weitere
 * Origins nur aus der Config. Kein DNS-Name wird von selbst vertraut (DNS-Rebinding), keine Zugangsdaten in URLs.
 */
export type GuardResult = { ok: true; url: string } | { ok: false; reason: string };

/** `http(s)://host[:port]` in Normalform, sonst null. */
export function normalizeOrigin(value: string): string | null {
  try {
    const u = new URL(value);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

export function serviceOrigins(ports: number[]): string[] {
  return ports.filter((p) => Number.isInteger(p) && p > 0 && p < 65_536).map((p) => `http://127.0.0.1:${p}`);
}

export function allowedOriginSet(ports: number[], extra: string[]): Set<string> {
  const set = new Set<string>(serviceOrigins(ports));
  for (const o of extra) {
    const n = normalizeOrigin(o);
    if (n) set.add(n);
  }
  return set;
}

/** Prüft eine Navigations-/Request-URL gegen die erlaubten Origins. */
export function checkUrl(raw: string, allowed: Set<string>): GuardResult {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: "keine gültige URL" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, reason: `Schema „${u.protocol}“ ist nicht erlaubt` };
  if (u.username || u.password) return { ok: false, reason: "Zugangsdaten in der URL sind nicht erlaubt" };
  if (!allowed.has(u.origin)) return { ok: false, reason: `Origin ${u.origin} ist nicht freigegeben` };
  return { ok: true, url: u.toString() };
}

/** Eingabe der Adressleiste: vollständige URL oder ein Pfad relativ zum ersten freigegebenen Origin. */
export function resolveTarget(input: string, allowed: Set<string>): GuardResult {
  const trimmed = input.trim();
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    const first = [...allowed][0];
    if (!first) return { ok: false, reason: "Kein freigegebener Dienst — der Workspace hat keinen laufenden Service." };
    return checkUrl(`${first}${trimmed}`, allowed);
  }
  return checkUrl(trimmed, allowed);
}

/** WebSocket-Ziele werden wie ihr http-Gegenstück geprüft. */
export function checkWebSocketUrl(raw: string, allowed: Set<string>): GuardResult {
  return checkUrl(raw.replace(/^ws(s?):/i, "http$1:"), allowed);
}
