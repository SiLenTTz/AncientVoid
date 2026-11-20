import { readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** BUG-0227: Präfixe, unter denen Hub und Tests ihre Temp-Verzeichnisse anlegen. */
const OWNED_PREFIXES = ["av-", "ancientvoid-"];

/** Verwaiste Temp-Verzeichnisse dieses Repos in einem Basisverzeichnis.
 *
 * BUG-0227: 145 Test-Dateien mkdtempen ohne gemeinsame Abräumphase; abgebrochene
 * Läufe leaken dauerhaft, bis /tmp (tmpfs, usrquota) voll ist und z. B. die
 * STT-Konvertierung des Hubs mit 422 „Aufnahme nicht lesbar" stirbt. Der Sweeper
 * läuft zu Beginn jedes Vitest-Laufs und räumt nur, was eindeutig verwaist ist:
 * Repo-eigene Präfixe und älter als ein Tag — laufende Suiten und der live
 * konvertierende Hub (Sekundenleben) bleiben unangetastet.
 */
export async function sweepTestTemp(base = tmpdir(), { maxAgeMs = 24 * 60 * 60 * 1000, now = Date.now() } = {}) {
  let entries;
  try {
    entries = await readdir(base, { withFileTypes: true });
  } catch {
    return 0;
  }
  let removed = 0;
  await Promise.all(
    entries
      .filter((e) => e.isDirectory() && OWNED_PREFIXES.some((p) => e.name.startsWith(p)))
      .map(async (e) => {
        const dir = join(base, e.name);
        try {
          const { mtimeMs } = await stat(dir);
          if (now - mtimeMs < maxAgeMs) return;
          await rm(dir, { recursive: true, force: true });
          removed += 1;
        } catch {
          // verschwunden oder nicht notrecht — der nächste Lauf versucht es wieder
        }
      }),
  );
  return removed;
}
