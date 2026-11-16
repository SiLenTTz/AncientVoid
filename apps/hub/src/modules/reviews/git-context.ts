import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** EPIC-P36: aktueller HEAD des Session-Workdir — Identitätsbestandteil des
 * uncommitteten Rests. Kein Repo/kein Commit → null (ehrlich, nicht geraten). */
export async function currentHeadSha(workdir: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", workdir, "rev-parse", "HEAD"], { timeout: 5000 });
    const sha = stdout.trim();
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
}
