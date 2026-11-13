import { describe, expect, it, beforeAll, beforeEach, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile, cp, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * BUG-0156: hub.sh darf eine installierte Unit nur bei nachgewiesener
 * Checkout-Identität (ANCIENTVOID_CONFIG == eigenes hub.config.json)
 * ansprechen — aus fremden Checkouts muss es sich laut weigern, statt die
 * Produktiv-Unit zu stoppen. systemctl wird dafür per PATH-Stub simuliert
 * (Muster: glab-stub), hub.sh in einen Temp-Checkout kopiert, damit $PWD
 * nicht der echte Repo-Root ist.
 */
const exec = (cmd: string, args: string[], opts: Record<string, unknown> = {}) =>
  new Promise<{ code: number; out: string }>((res) => {
    execFile(cmd, args, opts, (err, stdout, stderr) => {
      res({ code: err ? (err as { code?: number }).code ?? 1 : 0, out: `${stdout}${stderr}` });
    });
  });

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("hub.sh Unit-Weiche (BUG-0156)", () => {
  let dir: string;
  let binDir: string;
  let callsFile: string;
  let unitConfig: string;
  let env: Record<string, string>;

  /** systemctl-Stub: cat/show beantwortbar, jede Ausführung protokolliert. */
  async function writeStub(): Promise<void> {
    await writeFile(
      join(binDir, "systemctl"),
      [
        "#!/usr/bin/env bash",
        'echo "$@" >> "$UNIT_CALLS"',
        'if [ "$1" = "--user" ] && [ "$2" = "cat" ]; then exit 0; fi', // Unit "existiert"
        'if [ "$1" = "--user" ] && [ "$2" = "show" ]; then echo "ANCIENTVOID_CONFIG=$UNIT_CONFIG"; exit 0; fi',
        'if [ "$1" = "--user" ] && [ "$3" = "ancientvoid-hub.service" ]; then echo "unit $2 (stub)"; exit 0; fi',
        "exit 0",
      ].join("\n"),
      { mode: 0o755 },
    );
  }

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "av-hubsh-"));
    binDir = join(dir, "bin");
    callsFile = join(dir, "calls.log");
    unitConfig = "/fremder/checkout/hub.config.json";
    await mkdir(join(dir, "scripts"));
    await mkdir(binDir);
    // hub.sh in den Temp-Checkout: $PWD (= Skript-Root) ist dann fremd zur Unit.
    await cp(join(REPO, "scripts", "hub.sh"), join(dir, "scripts", "hub.sh"));
    await chmod(join(dir, "scripts", "hub.sh"), 0o755);
    await writeStub();
    env = { ...process.env, PATH: `${binDir}:${process.env.PATH}`, UNIT_CALLS: callsFile, UNIT_CONFIG: unitConfig, HOME: dir };
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  const calls = async () => (await readFile(callsFile, "utf8").catch(() => "")).trim().split("\n").filter(Boolean);
  /** Steuernde Aufrufe (start/stop/restart auf der Unit) — Probes (cat/show) sind lesend und erlaubt. */
  const controls = async () => (await (await calls()).filter((c) => /--user (stop|start|restart) ancientvoid-hub\.service/.test(c)));

  beforeEach(async () => {
    await rm(callsFile, { force: true }).catch(() => undefined);
  });

  it("fremde Unit: stop wird verweigert, systemctl nie berührt, HUB_LOCAL als Weg genannt", async () => {
    const r = await exec("bash", [join(dir, "scripts", "hub.sh"), "stop"], { env });
    expect(r.code).not.toBe(0);
    expect(await controls()).toEqual([]);
    expect(r.out).toContain("HUB_LOCAL=1");
  });

  it("fremde Unit: start wird ebenso verweigert (kein Neustart der Produktiv-Unit)", async () => {
    const r = await exec("bash", [join(dir, "scripts", "hub.sh"), "start"], { env });
    expect(r.code).not.toBe(0);
    expect(await controls()).toEqual([]);
  });

  it("eigene Unit (ANCIENTVOID_CONFIG zeigt auf diesen Checkout): Weiche leitet an systemctl", async () => {
    env = { ...env, UNIT_CONFIG: join(dir, "hub.config.json") };
    const r = await exec("bash", [join(dir, "scripts", "hub.sh"), "stop"], { env });
    expect(r.code).toBe(0);
    expect(await controls()).toContainEqual(expect.stringContaining("--user stop ancientvoid-hub.service"));
  });

  it("HUB_LOCAL=1 umgeht die Unit-Weiche und bleibt lokal (not running, kein systemctl)", async () => {
    env = { ...env, UNIT_CONFIG: "/fremder/checkout/hub.config.json" };
    const r = await exec("bash", [join(dir, "scripts", "hub.sh"), "stop"], { env: { ...env, HUB_LOCAL: "1" } });
    expect(r.code).toBe(0);
    expect(r.out).toContain("not running");
    expect(await controls()).toEqual([]);
  });
});
