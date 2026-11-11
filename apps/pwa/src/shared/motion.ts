/**
 * EPIC-P43 T43.1: der JavaScript-Teil der Bewegungssprache (Design-Review §4.2). Die CSS-Bewegungen
 * stehen in styles/36-motion.css; hier liegen „Wandern“ (View Transitions) und „Zählen“.
 * Bewegung ist aus, wenn das System es vorgibt oder der Schalter in den Einstellungen es sagt —
 * derselbe Schalter (`data-ctx-motion`), den Kontextleiste und Graph schon beachten.
 */
export function motionAllowed(): boolean {
  if (typeof document === "undefined") return false;
  if (document.documentElement.dataset.ctxMotion === "off") return false;
  return !(typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
}

type TransitionDocument = Document & { startViewTransition?: (update: () => void) => unknown };

/**
 * Wandern: führt `update` aus und lässt den Browser Elemente mit `view-transition-name` an ihren
 * neuen Ort gleiten. Ohne Unterstützung oder ohne Bewegung läuft `update` sofort — der Zustand ist
 * derselbe, nur der Weg fehlt.
 */
export function wander(update: () => void): void {
  const doc = document as TransitionDocument;
  if (!motionAllowed() || typeof doc.startViewTransition !== "function") {
    update();
    return;
  }
  doc.startViewTransition(update);
}

/**
 * Zählen: der nächste angezeigte Wert auf dem Weg von `shown` nach `target`, `elapsedMs` nach dem
 * letzten Schritt. Nähert sich exponentiell (halber Rest alle `halfLifeMs`), überschießt nie und
 * rastet ein, sobald der Rest kleiner als `snap` ist. Rein, damit die Anzeige testbar bleibt.
 */
export function countStep(shown: number, target: number, elapsedMs: number, halfLifeMs = 120, snap = 0.5): number {
  if (!Number.isFinite(shown) || !Number.isFinite(target)) return target;
  const rest = target - shown;
  if (Math.abs(rest) <= snap || halfLifeMs <= 0) return target;
  if (elapsedMs <= 0) return shown;
  const next = target - rest * 0.5 ** (elapsedMs / halfLifeMs);
  return Math.abs(target - next) <= snap ? target : next;
}
