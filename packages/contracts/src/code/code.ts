import { z } from "zod";

/**
 * T7.6: code on the phone — local search, a file viewer with line anchors,
 * and registered actions (tests, git, tools) run in a session's worktree.
 * Everything runs on the hub that owns the files; nothing leaves it.
 */

/** Which files a view is about: a session's worktree or a project folder. */
export const WorkspaceIdentity = z.object({
  kind: z.enum(["session", "project"]),
  sessionId: z.string().nullable(),
  root: z.string().min(1),
  branch: z.string().nullable(),
  /** Current commit of the checkout (null outside git). */
  head: z.string().nullable(),
  /** The commit a session worktree started from (its diff base). */
  base: z.string().nullable(),
});
export type WorkspaceIdentity = z.infer<typeof WorkspaceIdentity>;

export const CodeSearchMode = z.enum(["text", "symbol"]);
export type CodeSearchMode = z.infer<typeof CodeSearchMode>;

export const CodeMatch = z.object({
  path: z.string().min(1),
  /** 1-based, like editors and `#L` anchors. */
  line: z.number().int().positive(),
  column: z.number().int().positive(),
  text: z.string().max(300),
  /** `definition` when the line defines the searched name (symbol mode). */
  kind: z.enum(["definition", "match"]),
});
export type CodeMatch = z.infer<typeof CodeMatch>;

export const CodeSearchResult = z.object({
  identity: WorkspaceIdentity,
  engine: z.enum(["ripgrep", "git-grep"]),
  matches: z.array(CodeMatch),
  truncated: z.boolean(),
});
export type CodeSearchResult = z.infer<typeof CodeSearchResult>;

export const CODE_FILE_MAX_BYTES = 1024 * 1024;

export const CodeFile = z.object({
  identity: WorkspaceIdentity,
  path: z.string().min(1),
  language: z.string(),
  bytes: z.number().int().nonnegative(),
  lines: z.number().int().nonnegative(),
  /** Up to CODE_FILE_MAX_BYTES; `truncated` says when there is more. */
  content: z.string(),
  truncated: z.boolean(),
  binary: z.boolean(),
  /** git blob id of the file as it is on disk (null outside git). */
  blobSha: z.string().nullable(),
  /** Changed in this session's worktree compared to its base. */
  changed: z.object({ additions: z.number().int().nonnegative(), deletions: z.number().int().nonnegative() }).nullable(),
});
export type CodeFile = z.infer<typeof CodeFile>;

/** A parameter an action takes — always checked against its pattern. */
export const ActionParam = z.object({
  description: z.string().max(200).default(""),
  /** Anchored regex the value must match; the default allows a path. */
  pattern: z.string().default("^[\\w./@:+-]{1,200}$"),
  optional: z.boolean().default(false),
});
export type ActionParam = z.infer<typeof ActionParam>;

/**
 * A registered action. `argv` is run without a shell; `{name}` in an
 * element is replaced by the checked parameter value, and an element that
 * only names an optional, missing parameter is dropped.
 */
export const ActionDefinition = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/),
  label: z.string().min(1).max(60),
  kind: z.enum(["test", "git", "tool"]),
  /** Woher die Aktion stammt („package.json“, „Makefile“, „scripts/“ …) — nur zur Gruppierung in der Ansicht. */
  source: z.string().max(60).optional(),
  argv: z.array(z.string().min(1)).min(1),
  params: z.record(z.string(), ActionParam).default({}),
  /** Only reads (git status …) — nothing in the worktree changes. */
  readOnly: z.boolean().default(false),
  timeoutMs: z.number().int().positive().max(3_600_000).default(600_000),
  /**
   * Läuft bis zum Stoppen und ohne Zeitlimit: Dev-Server, Emulator, Apps, `docker compose up`. Solche Befehle
   * bekommen die Desktop-Umgebung (Fenster öffnen sich auf dem Rechner des Hubs) und einen „Stoppen“-Knopf.
   */
  longRunning: z.boolean().default(false),
});
export type ActionDefinition = z.infer<typeof ActionDefinition>;

export const ActionRunStatus = z.enum(["running", "succeeded", "failed", "timeout", "stopped"]);
export type ActionRunStatus = z.infer<typeof ActionRunStatus>;

export const ACTION_OUTPUT_MAX_CHARS = 64 * 1024;

export const ActionRun = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  actionId: z.string().min(1),
  argv: z.array(z.string()),
  status: ActionRunStatus,
  exitCode: z.number().int().nullable(),
  startedAt: z.string().min(1),
  endedAt: z.string().nullable(),
  actor: z.string().nullable(),
  /** The tail of stdout+stderr, at most ACTION_OUTPUT_MAX_CHARS. */
  output: z.string(),
  outputTruncated: z.boolean(),
});
export type ActionRun = z.infer<typeof ActionRun>;

/** Fills `{name}` placeholders; throws on a missing or invalid value. */
export function actionArgv(def: ActionDefinition, values: Record<string, string | undefined>): string[] {
  for (const name of Object.keys(values)) {
    if (!(name in def.params)) throw new Error(`Unbekannter Parameter „${name}“.`);
  }
  const argv: string[] = [];
  for (const part of def.argv) {
    const only = /^\{(\w+)\}$/.exec(part);
    if (only && def.params[only[1]!]?.optional && !values[only[1]!]) continue;
    argv.push(
      part.replace(/\{(\w+)\}/g, (_m, name: string) => {
        const param = def.params[name];
        if (!param) throw new Error(`Aktion ${def.id}: Platzhalter {${name}} ohne Parameter.`);
        const value = values[name];
        if (value === undefined || value === "") throw new Error(`Parameter „${name}“ fehlt.`);
        if (!new RegExp(param.pattern).test(value) || value.startsWith("-")) throw new Error(`Parameter „${name}“ ist ungültig.`);
        return value;
      }),
    );
  }
  return argv;
}
