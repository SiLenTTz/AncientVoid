import type { CommitNotation, NotationIntent, NotationRisk } from "@ancientvoid/contracts";

/** docs/commit-notation.md: `<Risiko> <Absicht> <bereich>: <Satz>`.
 * Bereich real beobachtet: `pwa`, `hubctl`, `hub/pwa`, `adapter-claude`, `epic-p7`. */
const NOTATION_RE = /^([.@^!]) ([FBrdteam]) ([a-z0-9][a-z0-9/._-]*): (.+)$/;
/** GitHub schreibt die PR-Nummer als `(#N)` ans Subject-Ende des Merge-Commits. */
const PR_NUMBER_RE = /\s\(#(\d+)\)$/;

/** ADR-0092: Subject in Notation zerlegen. Subjects ohne Notation (real z. B.
 * BUG-Titel wie PR #150) bleiben roh sichtbar (`unparsed`), nie gefiltert;
 * die PR-Nummer ist unabhängig davon optional — nichts wird geraten. */
export function parseCommitNotation(subject: string): CommitNotation {
  const pr = PR_NUMBER_RE.exec(subject);
  const prNumber = pr ? Number(pr[1]) : null;
  const withoutPr = pr ? subject.slice(0, pr.index) : subject;
  const m = NOTATION_RE.exec(withoutPr);
  if (!m) {
    return { raw: subject, risk: null, intent: null, area: null, summary: subject, prNumber, unparsed: true };
  }
  return {
    raw: subject,
    risk: m[1] as NotationRisk,
    intent: m[2] as NotationIntent,
    area: m[3] ?? null,
    summary: m[4] ?? "",
    prNumber,
    unparsed: false,
  };
}
