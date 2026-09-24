import { lstat, mkdir, open, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

type LockKind = "hub" | "backup";

/** The hub and backup share one exclusive data-directory lock. */
async function acquireDataDirLock(dataDir: string, kind: LockKind): Promise<() => Promise<void>> {
  const path = resolve(dataDir, ".uacc-hub.pid");
  const recoveryDir = `${path}.recovering`;
  try {
    await lstat(recoveryDir);
    throw new Error(`Hub-PID-Lock wird bereits bereinigt; falls kein Start läuft, verwaisten Recovery-Lock prüfen: ${recoveryDir}`);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Hub-PID-Lock wird")) throw err;
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const ownContent = `${kind}:${process.pid}\n`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(path, "wx", 0o600);
      try { await handle.writeFile(ownContent); }
      catch (err) { await unlink(path).catch(() => undefined); throw err; }
      finally { await handle.close(); }
      return async () => {
        const contents = await readFile(path, "utf8").catch(() => "");
        if (contents === ownContent) await unlink(path).catch(() => undefined);
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const contents = await readFile(path, "utf8").catch(() => "");
      const legacyPid = /^\d+$/.test(contents.trim()) ? Number(contents.trim()) : undefined;
      const parsed = /^(hub|backup):(\d+)$/.exec(contents.trim());
      const existingKind = parsed?.[1] as LockKind | undefined;
      const pid = legacyPid ?? (parsed ? Number(parsed[2]) : 0);
      if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error(`Ungültiger Hub-PID-Lock: ${path}`);
      try {
        process.kill(pid, 0);
        throw new Error(`${existingKind === "backup" ? "Ein Backup" : "Ein Hub"} läuft bereits (PID ${pid}, Lock ${path}).`);
      } catch (probeErr) {
        if (probeErr instanceof Error && / bereits \(PID /.test(probeErr.message)) throw probeErr;
        if ((probeErr as NodeJS.ErrnoException).code !== "ESRCH") throw new Error(`Hub-PID-Lock kann nicht geprüft werden: ${String(probeErr)}`);
      }
      await mkdir(recoveryDir, { mode: 0o700 }).catch((recoverErr: NodeJS.ErrnoException) => {
        if (recoverErr.code === "EEXIST") throw new Error(`Hub-PID-Lock wird bereits bereinigt; falls kein Start läuft, verwaisten Recovery-Lock prüfen: ${recoveryDir}`);
        throw recoverErr;
      });
      try {
        await writeFile(join(recoveryDir, "owner"), `${process.pid}\n`, { mode: 0o600 });
        const latestText = await readFile(path, "utf8").catch((readErr: NodeJS.ErrnoException) => {
          if (readErr.code === "ENOENT") return "";
          throw readErr;
        });
        if (latestText) {
          const latestPid = Number(latestText.trim().replace(/^(?:hub|backup):/, ""));
          if (!Number.isSafeInteger(latestPid) || latestPid <= 0) throw new Error(`Ungültiger Hub-PID-Lock: ${path}`);
          try {
            process.kill(latestPid, 0);
            throw new Error(`Ein Hub läuft bereits (PID ${latestPid}, Lock ${path}).`);
          } catch (probeErr) {
            if (probeErr instanceof Error && / bereits \(PID /.test(probeErr.message)) throw probeErr;
            if ((probeErr as NodeJS.ErrnoException).code !== "ESRCH") throw new Error(`Hub-PID-Lock kann nicht geprüft werden: ${String(probeErr)}`);
          }
          await unlink(path);
        }
      } finally {
        await rm(recoveryDir, { recursive: true, force: true });
      }
    }
  }
  throw new Error(`Konnte Hub-PID-Lock nicht erwerben: ${path}`);
}

/** Prevent two hub processes from opening one datadir concurrently. */
export function acquireHubPidLock(dataDir: string): Promise<() => Promise<void>> {
  return acquireDataDirLock(dataDir, "hub");
}

/** Keep the hub from starting while a consistent backup is being assembled. */
export function acquireBackupLock(dataDir: string): Promise<() => Promise<void>> {
  return acquireDataDirLock(dataDir, "backup");
}
