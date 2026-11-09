import { execFile } from "node:child_process";
import { promisify } from "node:util";

/**
 * EPIC-P37 / ADR-0056 §2: Der Host einer Session ergibt sich aus dem
 * `origin`-Remote des Workdirs — vom Nutzer gepushte Wahrheit, nicht geraten.
 * Git-Zugriffe laufen wie überall im Hub als reine argv-Übergabe.
 */

const execFileAsync = promisify(execFile);

export interface RemoteIdentity {
  host: string;
  /** Projekt-Pfad ohne .git, z. B. "SiLenT_Tz/AncientVoid". */
  projectPath: string;
}

/** Remote-URL (https-/ssh-Formen) → (host, path). Wirft bei unparsebaren URLs. */
export function parseRemoteUrl(url: string): RemoteIdentity {
  const trimmed = url.trim();
  // git@host:ns/proj.git oder ssh://git@host/ns/proj.git
  const scp = /^git@([a-z0-9.-]+):(.+?)(?:\.git)?$/i.exec(trimmed);
  if (scp?.[1] && scp[2]) return { host: scp[1].toLowerCase(), projectPath: stripGit(scp[2]) };
  const ssh = /^ssh:\/\/[^@]+@([a-z0-9.-]+)\/(.+?)(?:\.git)?$/i.exec(trimmed);
  if (ssh?.[1] && ssh[2]) return { host: ssh[1].toLowerCase(), projectPath: stripGit(ssh[2]) };
  const http = /^https?:\/\/([^/@]+@)?([a-z0-9.-]+)\/(.+?)(?:\.git)?$/i.exec(trimmed);
  if (http?.[2] && http[3]) return { host: http[2].toLowerCase(), projectPath: stripGit(http[3]) };
  throw new Error(`Remote-URL nicht als GitLab-Remote erkennbar: ${trimmed.slice(0, 120)}`);
}

function stripGit(path: string): string {
  return path.replace(/\.git$/i, "").replace(/^\/+/, "");
}

export interface MrUrlIdentity {
  host: string;
  projectPath: string;
  mrIid: number;
}

/** MR-URL (…/-/merge_requests/123) → Identität; wirft bei anderen Formen. */
export function parseMrUrl(url: string): MrUrlIdentity {
  const m = /^https?:\/\/([a-z0-9.-]+)\/(.+?)\/-\/merge_requests\/(\d+)/i.exec(url.trim());
  if (!m?.[1] || !m[2] || !m[3]) throw new Error("Keine GitLab-MR-URL (erwartet: https://<host>/<projekt>/-/merge_requests/<iid>)");
  return { host: m[1].toLowerCase(), projectPath: stripGit(m[2]), mrIid: Number(m[3]) };
}

async function git(workdir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", workdir, ...args], { timeout: 10_000, maxBuffer: 1024 * 1024 });
  return stdout.trim();
}

/**
 * Konfigurierte origin-URL — bewusst `git config` statt `git remote get-url`:
 * get-url wendet url.insteadOf-Umschreibungen an und würde lokale Test-Origins
 * verraten; die Identität soll die vom Nutzer konfigurierte sein.
 */
export async function remoteUrl(workdir: string): Promise<string | null> {
  try {
    const url = await git(workdir, ["config", "--get", "remote.origin.url"]);
    return url.length > 0 ? url : null;
  } catch {
    return null;
  }
}

/** Aktueller Branch des Workdirs (HEAD symbolisch); null im Detached-Zustand. */
export async function currentBranch(workdir: string): Promise<string | null> {
  try {
    const ref = await git(workdir, ["rev-parse", "--abbrev-ref", "HEAD"]);
    return ref === "HEAD" ? null : ref;
  } catch {
    return null;
  }
}

export async function headSha(workdir: string): Promise<string | null> {
  try {
    const sha = await git(workdir, ["rev-parse", "HEAD"]);
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

/** Commits `base..HEAD`, ältester zuerst — der Stand, den ein Push bringen würde. */
export async function commitsAhead(workdir: string, baseRef: string, max = 200): Promise<Array<{ sha: string; subject: string }>> {
  try {
    const out = await git(workdir, ["log", "--reverse", `--max-count=${max}`, "--format=%H%x1f%s", `${baseRef}..HEAD`]);
    return out
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [sha, ...subject] = line.split("\x1f");
        return { sha: sha!, subject: subject.join("\x1f") };
      });
  } catch {
    return [];
  }
}

/** Lokalen Stand des Origin-Branches lesen — null, wenn noch nie gepusht. */
export async function remoteBranchSha(workdir: string, branch: string): Promise<string | null> {
  try {
    const sha = await git(workdir, ["rev-parse", "--verify", "--quiet", `origin/${branch}`]);
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

/**
 * Push des Session-Branches — NUR dieser Ref, niemals main (ADR §4).
 * `git push origin HEAD:refs/heads/<branch>`; stderr enthält Progress, aber
 * nicht zwingend einen Fehler — Exit-Code entscheidet.
 */
export async function pushBranch(workdir: string, branch: string): Promise<void> {
  await execFileAsync("git", ["-C", workdir, "push", "origin", `HEAD:refs/heads/${branch}`], {
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
  });
}
