import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireBackupLock, acquireHubPidLock } from "../../src/platform/datadir-lock.ts";

describe("hub data-directory PID lock", () => {
  let dir = "";
  let release: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await release?.();
    release = undefined;
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("prevents a second process and removes the lock on release", async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-pid-lock-"));
    release = await acquireHubPidLock(dir);
    await expect(acquireHubPidLock(dir)).rejects.toThrow("Ein Hub läuft bereits");
    await release();
    await expect(readFile(join(dir, ".ancientvoid-hub.pid"))).rejects.toThrow();
    release = await acquireHubPidLock(dir);
  });

  it("rejects an invalid lock rather than assuming no hub is active", async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-pid-lock-"));
    await writeFile(join(dir, ".ancientvoid-hub.pid"), "unknown\n");
    await expect(acquireHubPidLock(dir)).rejects.toThrow("Ungültiger Hub-PID-Lock");
  });

  it("keeps the hub from starting during a backup", async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-pid-lock-"));
    release = await acquireBackupLock(dir);
    await expect(acquireHubPidLock(dir)).rejects.toThrow("Ein Backup läuft bereits");
  });

  it("recovers a stale PID lock under an exclusive recovery guard", async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-pid-lock-"));
    const lockPath = join(dir, ".ancientvoid-hub.pid");
    await writeFile(lockPath, "2147483647\n");
    release = await acquireHubPidLock(dir);
    expect(await readFile(lockPath, "utf8")).toBe(`hub:${process.pid}\n`);
    await expect(readFile(`${lockPath}.recovering`)).rejects.toThrow();
  });

  it("fails closed if a previous crash left the recovery guard", async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-pid-lock-"));
    await writeFile(join(dir, ".ancientvoid-hub.pid"), "2147483647\n");
    await mkdir(join(dir, ".ancientvoid-hub.pid.recovering"));
    await expect(acquireHubPidLock(dir)).rejects.toThrow("verwaisten Recovery-Lock prüfen");
  });
});
