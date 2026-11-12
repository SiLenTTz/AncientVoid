/**
 * Tooltip-Logik ohne DOM: Long-Press-Erkennung für Touch und die Textwahl.
 * Getrennt von Tooltip.tsx, damit Schwelle, Click-Unterdrückung und Abbruch
 * ohne Browser testbar sind.
 */

export const LONG_PRESS_MS = 450;
/** Wer den Finger weiter als das bewegt, scrollt oder wischt — kein Long-Press. */
export const MOVE_TOLERANCE_PX = 10;
/** Der Click, den der Browser nach dem Loslassen eines Long-Press noch schickt, kommt sofort; danach ist ein Tap wieder ein Tap. */
export const CLICK_SUPPRESS_MS = 600;

export interface LongPressOptions {
  onLongPress: () => void;
  delayMs?: number;
  tolerancePx?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

export interface LongPress {
  start(x: number, y: number): void;
  move(x: number, y: number): void;
  /** Finger weg. `true`, wenn der Druck lang genug war — der folgende Click wird dann geschluckt. */
  end(): boolean;
  /** Abbruch (Scroll, pointercancel, Fokuswechsel). */
  cancel(): void;
  /** Für den Click-Handler: `true` = Click gehört zu einem Long-Press und darf nichts auslösen. */
  shouldSuppressClick(): boolean;
}

export function createLongPress(options: LongPressOptions): LongPress {
  const delay = options.delayMs ?? LONG_PRESS_MS;
  const tolerance = options.tolerancePx ?? MOVE_TOLERANCE_PX;
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  let timer: unknown = null;
  let origin: { x: number; y: number } | null = null;
  let fired = false;
  let suppressUntil = 0;

  const stopTimer = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };

  return {
    start(x, y) {
      stopTimer();
      origin = { x, y };
      fired = false;
      timer = setTimer(() => {
        timer = null;
        fired = true;
        // Schon beim Auslösen sperren: manche Browser schicken den Click ohne eigenes pointerup-Ende.
        suppressUntil = Number.POSITIVE_INFINITY;
        options.onLongPress();
      }, delay);
    },
    move(x, y) {
      if (!origin || fired) return;
      if (Math.hypot(x - origin.x, y - origin.y) > tolerance) {
        stopTimer();
        origin = null;
      }
    },
    end() {
      stopTimer();
      const wasLong = fired;
      origin = null;
      fired = false;
      if (wasLong) suppressUntil = now() + CLICK_SUPPRESS_MS;
      return wasLong;
    },
    cancel() {
      stopTimer();
      origin = null;
      fired = false;
      suppressUntil = 0;
    },
    shouldSuppressClick() {
      if (now() <= suppressUntil) {
        suppressUntil = 0;
        return true;
      }
      return false;
    },
  };
}

export interface TipSource {
  dataTip?: string | null;
  ariaLabel?: string | null;
  title?: string | null;
  text?: string | null;
}

/** Tooltip-Text eines Elements: ausdrücklicher `data-tip` vor `aria-label`, `title`, sichtbarem Text. */
export function tipText(source: TipSource): string {
  for (const candidate of [source.dataTip, source.ariaLabel, source.title, source.text]) {
    const clean = candidate?.replace(/\s+/g, " ").trim();
    if (clean) return clean.length > 120 ? `${clean.slice(0, 117)}…` : clean;
  }
  return "";
}
