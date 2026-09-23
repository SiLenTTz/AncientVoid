/**
 * T3.10 (EPIC-P3 §4 "Sprach-Direktiven-Parser → Action-Mapping"): turns a
 * transcript T1.6-7's Voice sheet already captures (transcription-only,
 * "Vorschau" per its own doc comment) into a structured directive. This
 * module is exactly the missing "execution" half that T1.6-7 explicitly
 * deferred — it does not touch the sheet's speech-recognition path at all.
 *
 * Pure and synchronous: no DOM, no network, no session/API access — the
 * caller (VoiceSheet.tsx) turns a matched directive into a write-class
 * confirm dialog (AC-P3-7: "nicht Sofort-Exekution") and only calls the
 * real API after the user taps confirm. That boundary is deliberate: a
 * parser that could itself trigger an action would make "always confirm
 * before acting" a convention instead of a structural guarantee.
 *
 * Scope, stated honestly: only the two directives EPIC-P3 §4 names by
 * example (`stopp` = write-Gate, Budget-Änderung = write-Gate mit
 * Summary) are implemented. A fuller directive grammar (start a session,
 * navigate, read back quota — T1.6-7's own EXAMPLE_COMMANDS) is real
 * future scope, not silently implied as done by this module's existence.
 */

export type VoiceDirective =
  | { kind: "stop"; summary: string }
  | { kind: "budget"; amountUsd: number; summary: string }
  | { kind: "unrecognized" };

const STOP_PATTERNS = [
  /\bstopp?\b/i,
  /\bstoppe?\s+(die\s+)?session\b/i,
  /\bsession\s+stoppen\b/i,
  /\bbrich\s+(die\s+)?session\s+ab\b/i,
];

// Accepts "budget auf 5 dollar/euro/$ erhöhen", "erhöhe das budget auf 5",
// "budget auf 5,50 setzen" — German decimal comma normalized to a dot.
const BUDGET_PATTERN =
  /budget\D{0,20}?(\d+(?:[.,]\d+)?)\s*(dollar|euro|eur|usd|\$|€)?/i;

export function parseVoiceDirective(transcriptRaw: string): VoiceDirective {
  const transcript = transcriptRaw.trim();
  if (!transcript) return { kind: "unrecognized" };

  const budgetMatch = BUDGET_PATTERN.exec(transcript);
  if (budgetMatch) {
    const amountUsd = Number(budgetMatch[1]!.replace(",", "."));
    if (Number.isFinite(amountUsd) && amountUsd > 0) {
      return {
        kind: "budget",
        amountUsd,
        summary: `Budget auf ${amountUsd.toFixed(2)}$ ändern`,
      };
    }
  }

  if (STOP_PATTERNS.some((re) => re.test(transcript))) {
    return { kind: "stop", summary: "Diese Session stoppen" };
  }

  return { kind: "unrecognized" };
}
