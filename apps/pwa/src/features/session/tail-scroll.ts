/**
 * EPIC-P43 AC-P43-7 / AI-P43-3: Scrollposition von `.tail-scroll` je Session und Reiter.
 * Gerätezustand in localStorage (nicht sessionStorage): Popouts öffnen mit `noopener`
 * und haben sonst keinen Zugriff auf die Position der Kachel. Keine Session-Wahrheit (K7).
 */

export function tailScrollKey(sessionId: string, tab: string): string {
  return `ancientvoid.tailScroll.${sessionId}.${tab}`;
}

export function readTailScroll(sessionId: string, tab: string): number | null {
  try {
    const raw = localStorage.getItem(tailScrollKey(sessionId, tab));
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

export function writeTailScroll(sessionId: string, tab: string, top: number): void {
  try {
    const key = tailScrollKey(sessionId, tab);
    if (!Number.isFinite(top) || top <= 0) localStorage.removeItem(key);
    else localStorage.setItem(key, String(Math.round(top)));
  } catch {
    /* private mode / quota — Scroll ist Komfort, kein Fehlerzustand */
  }
}
