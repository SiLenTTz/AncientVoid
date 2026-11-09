import type { SessionRecord } from "../../shared/api.ts";

/** EPIC-P38 (ADR-0057): Arbeitsort der Session — beim Namen genannt, nie als Sicherheitsgrenze beworben. */
export function WorkplaceBadge({ session }: { session: Pick<SessionRecord, "workspaceMode" | "worktreeSha"> }) {
  const mode = session.workspaceMode ?? (session.worktreeSha ? "worktree" : "unknown");
  if (mode === "worktree") return <span class="workplace-badge" data-mode="worktree" title="Eigener Git-Worktree — trennt Dateien, keine Sandbox">Worktree</span>;
  if (mode === "direct") return <span class="workplace-badge warn" data-mode="direct" title="Arbeitet direkt im Projektordner">Projekt direkt</span>;
  return <span class="workplace-badge warn" data-mode="unknown" title="Für diese ältere Session ist der Arbeitsort nicht belegt">Arbeitsort ungeklärt</span>;
}
