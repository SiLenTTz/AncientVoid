/**
 * Decisions for `npm run test:phone` (BUG-0055, EPIC-P16 T16.4).
 * Pure: the script and the Playwright fixture both call this, the test covers it.
 */

/** Android `dumpsys window displays` — `ROTATION_90` or a bare quarter turn. */
export function quarterFromDumpsys(text) {
  const named = /mDisplayRotation=ROTATION_(\d+)/.exec(text);
  if (named) {
    if (named[1] === "0") return "0";
    if (named[1] === "90") return "1";
    if (named[1] === "180") return "2";
    if (named[1] === "270") return "3";
  }
  return /(?:^|\s)mRotation=(\d)\b/.exec(text)?.[1] ?? null;
}

/**
 * @param {{ quarter: string | null, cdpDown: boolean, lockPortrait: boolean }} state
 * @returns {string | null} sentence to end the run with, or null to continue
 */
export function abortReason(state) {
  if (state.cdpDown) return "DevTools-Verbindung zum Handy ist weg. Lauf abgebrochen.";
  if (state.lockPortrait && (state.quarter === "1" || state.quarter === "3")) {
    return "Das Handy liegt im Querformat. Lauf abgebrochen.";
  }
  return null;
}
