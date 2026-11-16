/** Ziel der globalen Git-Struktur-Ebene: Projektordner oder Session-Worktree (wie FilesRoot). */
export type GitTarget = { kind: "project"; path: string; label: string; hostId?: string } | { kind: "session"; id: string; label: string; hostId?: string };

export const gitTargetQuery = (target: GitTarget): string =>
  target.kind === "session" ? `session=${encodeURIComponent(target.id)}` : `project=${encodeURIComponent(target.path)}`;

export interface GitState {
  open: boolean;
  target: GitTarget | null;
}

const KEY = "ancientvoid.git.v1";

export const defaultGitState = (): GitState => ({ open: false, target: null });

/** Gerätelokal, versioniert — keine neue Session-Wahrheit (ADR-0058 §6). */
export function loadGitState(): GitState {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<GitState> | null;
    if (!raw) return defaultGitState();
    return { ...defaultGitState(), ...raw };
  } catch {
    return defaultGitState();
  }
}

export function saveGitState(state: GitState): void {
  localStorage.setItem(KEY, JSON.stringify(state));
}
