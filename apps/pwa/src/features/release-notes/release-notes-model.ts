import type { CommitNotation, NotationIntent, NotationRisk } from "@ancientvoid/contracts";

/** EPIC-P70 (ADR-0092): Labels zu docs/commit-notation.md — Klartext statt Codezeichen. */
export const RISK_LABEL: Record<NotationRisk, string> = {
  ".": "beweisbar sicher",
  "^": "geprüft",
  "!": "riskant",
  "@": "Zwischenstand",
};

export const INTENT_LABEL: Record<NotationIntent, string> = {
  F: "Feature",
  B: "Bugfix",
  r: "Refactoring",
  d: "Doku",
  t: "Tests",
  e: "Umgebung",
  a: "automatisch",
  m: "Merge",
};

/** Kurzzeile einer Notation: „geprüft · Feature · pwa“ bzw. „ohne Notation“ (fail loud). */
export function notationLine(n: CommitNotation): string {
  if (n.unparsed) return "ohne Notation";
  return [n.risk ? RISK_LABEL[n.risk] : "", n.intent ? INTENT_LABEL[n.intent] : "", n.area ?? ""].filter(Boolean).join(" · ");
}

/** ±Zeilen aus den Stats — „3 Dateien · +24 · −7“; ohne Stats ehrlich leer. */
export function statsLine(n: { filesChanged: number; insertions: number; deletions: number } | null): string {
  if (!n) return "";
  return `${n.filesChanged} ${n.filesChanged === 1 ? "Datei" : "Dateien"} · +${n.insertions} · −${n.deletions}`;
}

export interface ReleaseNotesPrefs {
  /** Absoluter Projektpfad des gewählten Repositorys; null = noch nicht gewählt. */
  project: string | null;
}

const KEY = "ancientvoid.releasenotes.v1";

/** Gerätelokal, versioniert — keine neue Session-Wahrheit (Muster git-model.ts, ADR-0058 §6). */
export function loadReleaseNotesPrefs(): ReleaseNotesPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<ReleaseNotesPrefs> | null;
    if (!raw) return { project: null };
    return { project: typeof raw.project === "string" ? raw.project : null };
  } catch {
    return { project: null };
  }
}

export function saveReleaseNotesPrefs(prefs: ReleaseNotesPrefs): void {
  localStorage.setItem(KEY, JSON.stringify(prefs));
}
