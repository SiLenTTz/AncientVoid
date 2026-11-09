import { z } from "zod";

/**
 * EPIC-P46 T46.7 (ADR-0058 §9): Diagnosen mit Ursprung. Syntaxfarben sind keine Fehlererkennung — „ok“ gibt es nur,
 * wenn ein Provider vollständig gelaufen ist; ohne Provider heißt es `not_configured`, nie „0 Fehler“.
 */
export const DiagnosticSeverity = z.enum(["error", "warning", "info"]);
export type DiagnosticSeverity = z.infer<typeof DiagnosticSeverity>;

export const Diagnostic = z.object({
  /** Datei der Meldung relativ zur Root (bei Projektchecks auch eine andere als die angefragte). */
  path: z.string(),
  /** 1-basiert; Spalten in UTF-16-Einheiten (= JS-String-Index + 1), unabhängig von CRLF/Emoji. */
  line: z.number().int().positive(),
  column: z.number().int().positive(),
  endLine: z.number().int().positive().nullable().default(null),
  endColumn: z.number().int().positive().nullable().default(null),
  severity: DiagnosticSeverity,
  code: z.string().nullable().default(null),
  message: z.string().max(2000),
  source: z.string(),
});
export type Diagnostic = z.infer<typeof Diagnostic>;

export const DiagnosticState = z.enum([
  /** Provider vollständig gelaufen, keine Fehler (Warnungen möglich). */
  "ok",
  "errors",
  /** Kein Provider für diese Sprache/dieses Projekt — keine Aussage über Fehlerfreiheit. */
  "not_configured",
  /** Projekt ist nicht freigegeben: es wurde nichts ausgeführt. */
  "untrusted",
  "failed",
  "timeout",
  "too_large",
]);
export type DiagnosticState = z.infer<typeof DiagnosticState>;

export const DiagnosticsResult = z.object({
  path: z.string(),
  /** Dateirevision beim Prüfen; weicht sie von der aktuellen ab, ist das Ergebnis veraltet. */
  revision: z.string(),
  language: z.string(),
  /** Wer geprüft hat, z. B. „JSON.parse“, „tsc (Projekt)“, „Python ast“. */
  provider: z.string().nullable(),
  /** `syntax` = nur Grammatik, `types` = Typ-/Projektprüfung. */
  scope: z.enum(["syntax", "types"]).nullable(),
  state: DiagnosticState,
  detail: z.string().nullable(),
  diagnostics: z.array(Diagnostic).max(500),
  /** Meldungen in anderen Dateien desselben Projektchecks (nicht in `diagnostics`). */
  otherFiles: z.number().int().nonnegative().default(0),
  truncated: z.boolean().default(false),
  checkedAt: z.string(),
  durationMs: z.number().nonnegative(),
});
export type DiagnosticsResult = z.infer<typeof DiagnosticsResult>;

export const ProjectTrust = z.object({ trusted: z.boolean(), project: z.string(), by: z.string().nullable(), at: z.string().nullable() });
export type ProjectTrust = z.infer<typeof ProjectTrust>;
