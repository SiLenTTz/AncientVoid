import { z } from "zod";

/**
 * EPIC-P29 / ADR-0051: deklaratives Workspace-Manifest. Ein Projekt erklärt
 * damit sein Setup, seine zu übernehmenden lokalen Dateien und seine Services.
 * Ohne Manifest gilt der unveränderte T2.1-Pfad (Migrationsregel, ADR-0051 §7).
 *
 * Das Manifest ist eine Vertrauensgrenze: gelesen wird es an der festgehaltenen
 * Basis-SHA, ausgeführt erst nach menschlicher Hash-Freigabe. Unbekannte
 * Version oder Felder failen laut (strict), nie still.
 */

export const WORKSPACE_MANIFEST_FILENAME = "ancientvoid.workspace.json";
export const WORKSPACE_MANIFEST_SCHEMA_VERSION = 1;

/** Schritt- und Service-IDs: kurze, stabile Slug-Form. */
export const WorkspaceSlug = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);
export type WorkspaceSlug = z.infer<typeof WorkspaceSlug>;

export const WORKSPACE_ARGV_MAX = 64;
export const WORKSPACE_ARG_MAX_CHARS = 512;
export const WORKSPACE_STEPS_MAX = 16;
export const WORKSPACE_INCLUDE_MAX = 256;
export const WORKSPACE_INCLUDE_MAX_CHARS = 260;
export const WORKSPACE_SERVICES_MAX = 8;
export const WORKSPACE_TIMEOUT_MS_MIN = 1_000;
export const WORKSPACE_TIMEOUT_MS_MAX = 600_000;
export const WORKSPACE_PORT_MIN = 1_024;
export const WORKSPACE_PORT_MAX = 65_535;
/** Obergrenze des Manifests selbst (Byte, Rohdatei an der Basis-SHA) — der Resolver lehnt Größeres laut ab. */
export const WORKSPACE_MANIFEST_MAX_BYTES = 64 * 1024;
/** Budget der Dateiübernahme: Summe der Dateigrößen (ADR-0051 §1: Anzahl/Bytes begrenzt). */
export const WORKSPACE_INCLUDE_MAX_BYTES = 32 * 1024 * 1024;

/** argv ohne Shell: Programm plus Argumente, jedes einzeln nicht-leer. */
export const WorkspaceArgv = z
  .array(z.string().min(1).max(WORKSPACE_ARG_MAX_CHARS))
  .min(1)
  .max(WORKSPACE_ARGV_MAX);

/** Ein Setup-/Teardown-Schritt: benanntes argv mit eigener Frist. Das cwd ist immer die Worktree-Wurzel. */
export const WorkspaceStep = z.object({
  id: WorkspaceSlug,
  argv: WorkspaceArgv,
  timeoutMs: z.number().int().min(WORKSPACE_TIMEOUT_MS_MIN).max(WORKSPACE_TIMEOUT_MS_MAX),
});
export type WorkspaceStep = z.infer<typeof WorkspaceStep>;

/**
 * Include-Eintrag: relative, reguläre Datei innerhalb des Quellprojekts —
 * Liste, keine Globs. Schema prüft die Pfadform; was nur das Dateisystem
 * wissen kann (reguläre Datei, gitignoriert, kein Überschreiben verfolgter
 * Zieldateien, Symlink-Ziel) prüft der Resolver in T29.2.
 */
export const WorkspaceIncludePath = z
  .string()
  .max(WORKSPACE_INCLUDE_MAX_CHARS)
  .refine(isValidIncludePath, { message: "include: relativer Dateipfad ohne Traversal, Globs, .git/ und data/" });

function isValidIncludePath(p: string): boolean {
  if (p === "" || p.startsWith("/") || p.includes("\\") || p.includes("\0")) return false;
  const segments = p.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) return false;
  if (segments.some((s) => /[*?[]/.test(s))) return false;
  if (segments[0] === ".git" || segments[0] === "data") return false;
  return true;
}

/** HTTP-Readiness: Pfad auf dem Service, der 2xx/3xx melden muss, bevor „ready“ gilt. */
export const WorkspaceReadiness = z.object({
  path: z.string().min(1).max(200).regex(/^\//, "readiness.path muss mit / beginnen"),
  timeoutMs: z.number().int().min(WORKSPACE_TIMEOUT_MS_MIN).max(WORKSPACE_TIMEOUT_MS_MAX).optional(),
});
export type WorkspaceReadiness = z.infer<typeof WorkspaceReadiness>;

/**
 * Port: `number` = Fixport (Belegung führt zu `failed`, nie zum Töten fremder
 * Prozesse), `"auto"` oder fehlend = Vergabe durch den Hub mit begrenztem
 * Retry bei Bind-Race. Dienste binden an Loopback (ADR-0051 §4).
 */
export const WorkspacePort = z.union([z.number().int().min(WORKSPACE_PORT_MIN).max(WORKSPACE_PORT_MAX), z.literal("auto")]);

/** Ein verwalteter Service des Workspaces. */
export const WorkspaceService = z.object({
  id: WorkspaceSlug,
  argv: WorkspaceArgv,
  port: WorkspacePort.optional(),
  readiness: WorkspaceReadiness.optional(),
});
export type WorkspaceService = z.infer<typeof WorkspaceService>;

/** Das Manifest v1. Strict: unbekannte Felder sind ein Fehler, kein Rätsel. */
export const WorkspaceManifest = z
  .object({
    schemaVersion: z.literal(WORKSPACE_MANIFEST_SCHEMA_VERSION),
    setup: z.array(WorkspaceStep).max(WORKSPACE_STEPS_MAX).optional(),
    teardown: z.array(WorkspaceStep).max(WORKSPACE_STEPS_MAX).optional(),
    include: z.array(WorkspaceIncludePath).max(WORKSPACE_INCLUDE_MAX).optional(),
    services: z.array(WorkspaceService).max(WORKSPACE_SERVICES_MAX).optional(),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    for (const key of ["setup", "teardown"] as const) {
      const steps = manifest[key] ?? [];
      const seen = new Set<string>();
      for (const step of steps) {
        if (seen.has(step.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `doppelte Schritt-ID "${step.id}"` });
        seen.add(step.id);
      }
    }
    const services = manifest.services ?? [];
    const seenServices = new Set<string>();
    for (const service of services) {
      if (seenServices.has(service.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["services"], message: `doppelte Service-ID "${service.id}"` });
      seenServices.add(service.id);
    }
    const includes = manifest.include ?? [];
    if (new Set(includes).size !== includes.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["include"], message: "doppelte Include-Pfade" });
    }
  });
export type WorkspaceManifest = z.infer<typeof WorkspaceManifest>;
