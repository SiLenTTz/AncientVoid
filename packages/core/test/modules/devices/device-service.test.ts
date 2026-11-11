import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { DeviceError, DeviceService, type DeviceExec } from "@ancientvoid/core";
import { DEVICE_OWNERSHIP_ENV } from "@ancientvoid/contracts";

/** EPIC-P42 (ADR-0067): Device-Dienst mit Ausführungsnähe — Eigentum, Lease/Generation, Geometrie-Drift,
 * Wiederanlauf aus dem Journal (K7), Grenzen für Logs/Bäume/Installation. Kein echtes SDK nötig. */

class FakeExec implements DeviceExec {
  readonly runs: { argv: string[]; timeoutMs: number }[] = [];
  readonly spawns: { argv: string[]; env: Record<string, string>; logFile: string; pid: number }[] = [];
  private readonly procs = new Map<number, { alive: boolean; env: Record<string, string> }>();
  private nextPid = 4100;
  /** Skript: argv → Antwort; `null` = Exit 0 ohne Ausgabe. */
  respond: (argv: string[]) => { code: number; stdout: string | Buffer } | null = () => null;
  devicesStdout = "";
  avdsStdout = "av-test\n";

  private argvKey(argv: string[]): string {
    return argv.slice(1).join(" ");
  }

  run(argv: string[], opts: { timeoutMs: number }): Promise<{ code: number; stdout: Buffer; stderr: string }> {
    this.runs.push({ argv, timeoutMs: opts.timeoutMs });
    if (this.argvKey(argv) === "devices -l") {
      return Promise.resolve({ code: 0, stdout: Buffer.from(`List of devices attached\n${this.devicesStdout}`), stderr: "" });
    }
    if (this.argvKey(argv).startsWith("-list-avds") || argv[1] === "-list-avds") {
      return Promise.resolve({ code: 0, stdout: Buffer.from(this.avdsStdout), stderr: "" });
    }
    const r = this.respond(argv);
    return Promise.resolve({ code: r?.code ?? 0, stdout: Buffer.from(r?.stdout ?? ""), stderr: "" });
  }
  spawnDetached(argv: string[], opts: { env: Record<string, string>; logFile: string }): { pid: number } {
    const pid = this.nextPid++;
    this.spawns.push({ argv, env: opts.env, logFile: opts.logFile, pid });
    this.procs.set(pid, { alive: true, env: opts.env });
    return { pid };
  }
  async ownedAlive(pid: number, marker: string): Promise<boolean> {
    const p = this.procs.get(pid);
    return Boolean(p?.alive && p.env[DEVICE_OWNERSHIP_ENV] === marker);
  }
  async kill(pid: number, signal: "SIGTERM" | "SIGKILL"): Promise<void> {
    const p = this.procs.get(pid);
    if (p && signal === "SIGTERM") p.alive = false; // Test: Emulator beendet auf SIGTERM
    if (p && signal === "SIGKILL") p.alive = false;
  }
  async exited(pid: number): Promise<boolean> {
    return !this.procs.get(pid)?.alive;
  }
}

/** Minimal gültiges PNG (Signatur + IHDR) mit Größe W×H. */
function pngBytes(width: number, height: number): Buffer {
  const buf = Buffer.alloc(33);
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  buf.writeUInt32BE(0x0d, 8); // IHDR-Länge
  buf.write("IHDR", 12);
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

async function waitUntil(cond: () => boolean | Promise<boolean>, ms = 8_000): Promise<void> {
  const start = Date.now();
  while (!(await cond())) {
    if (Date.now() - start > ms) throw new Error("Bedingung nicht erfüllt (Timeout im Test)");
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("DeviceService (EPIC-P42)", () => {
  let dir: string;
  let exec: FakeExec;

  const makeSvc = (opts: Partial<ConstructorParameters<typeof DeviceService>[0]> = {}) =>
    new DeviceService({
      dataDir: dir,
      sdkRoot: join(dir, "sdk"),
      avdHome: join(dir, "avd"),
      kvmPath: join(dir, "kvm"),
      exec,
      watchIntervalMs: 20,
      bootTimeoutMs: 5_000,
      ...opts,
    });

  /** Startet den Fake-Emulator und wartet auf `ready`. */
  const boot = async (svc: DeviceService): Promise<string> => {
    const entry = await svc.startEmulator("av-test", "sess-1");
    const serial = entry.serial;
    exec.devicesStdout = `${serial}          device product:sdk_gphone64_x86_64 model:sdk_gphone64_x86_64 transport_id:1\n`;
    exec.respond = (argv) => {
      const key = argv.slice(1).join(" ");
      if (key === `-s ${serial} emu avd name`) return { code: 0, stdout: "av-test\nOK" };
      if (key === `-s ${serial} shell getprop sys.boot_completed`) return { code: 0, stdout: "1\n" };
      if (key === `-s ${serial} exec-out screencap -p`) return { code: 0, stdout: pngBytes(1080, 2400) };
      if (key === `-s ${serial} shell wm size`) return { code: 0, stdout: "Physical size: 1080x2400\n" };
      if (key === `-s ${serial} shell getprop ro.build.version.sdk`) return { code: 0, stdout: "35\n" };
      if (key === `-s ${serial} shell getprop ro.build.fingerprint`) return { code: 0, stdout: "google/sdk_gphone64_x86_64:15:AVD\n" };
      if (key === `-s ${serial} exec-out uiautomator dump /dev/tty`) return { code: 0, stdout: "UI hierarchy dumped to: /dev/tty.\n<?xml version=\"1.0\"?><hierarchy><node text=\"AncientVoid\" /></hierarchy>" };
      if (key.startsWith(`-s ${serial} logcat`)) return { code: 0, stdout: "line1\nAuthorization: Bearer abcd1234567890\npassword=hunter2\n" };
      return null;
    };
    await waitUntil(async () => (await svc.status()).devices.find((d) => d.serial === serial)?.instance?.state === "ready");
    return serial;
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-devices-"));
    exec = new FakeExec();
    await mkdir(join(dir, "sdk", "platform-tools"), { recursive: true });
    await mkdir(join(dir, "sdk", "emulator"), { recursive: true });
    await mkdir(join(dir, "avd", "av-test.avd"), { recursive: true });
    await writeFile(join(dir, "sdk", "platform-tools", "adb"), "#!/bin/sh\n");
    await writeFile(join(dir, "sdk", "emulator", "emulator"), "#!/bin/sh\n");
    await writeFile(join(dir, "kvm"), "");
    await writeFile(join(dir, "avd", "av-test.avd", "config.ini"), "hw.lcd.width=1080\nhw.lcd.height=2400\n");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // ---- T42.1: Fähigkeiten, ehrlich fehlend -----------------------------------------------------------------
  it("Capabilities: ohne SDK/KVM nicht bereit, mit Gründen (fail loud)", async () => {
    const broken = new DeviceService({ dataDir: dir, sdkRoot: join(dir, "gibtsnicht"), kvmPath: join(dir, "kein-kvm"), exec });
    const caps = broken.capabilities();
    expect(caps.ready).toBe(false);
    expect(caps.reasons.some((r) => r.includes("existiert nicht"))).toBe(true);
    expect(caps.kvm.available).toBe(false);
    await expect(broken.startEmulator("av-test", null)).rejects.toMatchObject({ code: "unavailable" });
  });

  it("Capabilities: vollständiges SDK + KVM sind bereit", () => {
    expect(makeSvc().capabilities().ready).toBe(true);
  });

  // ---- T42.2: Start, Eigentum, AVD-Auswahl ------------------------------------------------------------------
  it("startEmulator: headless argv mit Ownership-Marker und festem Port; Journal hält Eigentum fest", async () => {
    const svc = makeSvc();
    const serial = await boot(svc);
    expect(serial).toBe("emulator-5554");
    const spawn = exec.spawns[0]!;
    expect(spawn.argv).toContain("-avd");
    expect(spawn.argv).toContain("av-test");
    expect(spawn.argv).toContain("-no-snapshot");
    expect(spawn.argv.slice(-2)).toEqual(["-port", "5554"]);
    expect(spawn.env[DEVICE_OWNERSHIP_ENV]).toBeDefined();
    const journal = await readFile(join(dir, "devices", "devices.jsonl"), "utf8");
    const started = journal.split("\n").filter(Boolean).map((l) => JSON.parse(l) as { t: string; marker?: string }).find((r) => r.t === "started");
    expect(started?.marker).toBe(spawn.env[DEVICE_OWNERSHIP_ENV]);
  });

  it("startEmulator: unbekannter und nicht erlaubter AVD werden verweigert", async () => {
    const svc = makeSvc({ avdAllowlist: ["anderer"] });
    await expect(svc.startEmulator("av-test", null)).rejects.toMatchObject({ code: "blocked" });
    const svc2 = makeSvc();
    exec.devicesStdout = "";
    await expect(svc2.startEmulator("gibtsnicht", null)).rejects.toMatchObject({ code: "not_found" });
  });

  it("stopEmulator: SIGTERM→beendet mit Journal; fremde Emulatoren und physische Geräte werden nie beendet", async () => {
    const svc = makeSvc();
    const serial = await boot(svc);
    await expect(svc.stopEmulator(serial)).resolves.toMatchObject({ stopped: true });
    const journal = await readFile(join(dir, "devices", "devices.jsonl"), "utf8");
    expect(journal).toContain('"t":"stopped"');

    exec.devicesStdout = "HT123\tdevice transport_id:9\nemulator-6666\tdevice transport_id:8\n";
    await expect(svc.stopEmulator("HT123")).rejects.toMatchObject({ code: "blocked", message: expect.stringContaining("Physische") });
    await expect(svc.stopEmulator("emulator-6666")).rejects.toMatchObject({ code: "blocked", message: expect.stringContaining("Fremde") });
    await expect(svc.stopEmulator("emulator-9999")).rejects.toMatchObject({ code: "not_found" });
  });

  it("Quota: ein zweiter, anderer AVD wird verweigert; derselbe AVD bleibt idempotent", async () => {
    exec.avdsStdout = "av-test\nav-zwei\n";
    const svc = makeSvc({ maxEmulators: 1 });
    await boot(svc);
    await expect(svc.startEmulator("av-test", null)).resolves.toBeTruthy(); // derselbe AVD → bestehende Instanz
    await expect(svc.startEmulator("av-zwei", null)).rejects.toMatchObject({ code: "quota" });
  });

  // ---- T42.3: Lease/Generation/Drift -------------------------------------------------------------------------
  it("Eingaben ohne passenden Lease-Generation werden verweigert (AC-P42-3)", async () => {
    const svc = makeSvc();
    const serial = await boot(svc);
    await expect(svc.act({ serial, generation: 1, geometryVersion: 1, action: { type: "tap", x: 10, y: 10 } })).rejects.toMatchObject({ code: "conflict" });
    const lease = await svc.acquireLease(serial, "sess-1", "mensch");
    expect(lease.generation).toBeGreaterThan(0);
    await expect(svc.acquireLease(serial, "sess-2", "anderer")).rejects.toMatchObject({ code: "busy" });
  });

  it("Tap landet als feste argv; Rotation macht alle alten Bilder ungültig (Geometrie-Drift)", async () => {
    const svc = makeSvc();
    const serial = await boot(svc);
    const { generation } = await svc.acquireLease(serial, "sess-1", "mensch");
    const res = await svc.act({ serial, generation, geometryVersion: 1, action: { type: "tap", x: 540, y: 1200 } });
    expect(exec.runs.some((r) => r.argv.join(" ").endsWith("shell input tap 540 1200"))).toBe(true);
    expect(res.geometryVersion).toBe(1);

    const rotated = await svc.act({ serial, generation, geometryVersion: 1, action: { type: "rotate", orientation: "landscape" } });
    expect(rotated.geometryVersion).toBe(2);
    await expect(svc.act({ serial, generation, geometryVersion: 1, action: { type: "tap", x: 1, y: 1 } })).rejects.toMatchObject({ code: "conflict", message: expect.stringContaining("veraltet") });
    await expect(svc.act({ serial, generation, geometryVersion: 2, action: { type: "tap", x: 1, y: 1 } })).resolves.toBeTruthy();
  });

  it("Text mit „%“/Metazeichen wird vor adb verweigert; gültiger Text wird als %s übertragen", async () => {
    const svc = makeSvc();
    const serial = await boot(svc);
    const { generation } = await svc.acquireLease(serial, null, "mensch");
    await expect(svc.act({ serial, generation, geometryVersion: 1, action: { type: "text", text: "50%" } })).rejects.toMatchObject({ code: "blocked" });
    await svc.act({ serial, generation, geometryVersion: 1, action: { type: "text", text: "Hallo Welt" } });
    expect(exec.runs.some((r) => r.argv.join(" ").endsWith("shell input text Hallo%sWelt"))).toBe(true);
  });

  it("Release mit falscher Generation wird verweigert; richtige gibt frei", async () => {
    const svc = makeSvc();
    const serial = await boot(svc);
    const { generation } = await svc.acquireLease(serial, null, "mensch");
    let wrongGeneration = false;
    try {
      svc.releaseLease(serial, generation + 5); // synchrone Verweigerung — falsche Generation wird nie akzeptiert
    } catch (err) {
      wrongGeneration = err instanceof DeviceError && err.code === "conflict";
    }
    expect(wrongGeneration).toBe(true);
    expect(svc.releaseLease(serial, generation).released).toBe(true);  });

  // ---- Frames / Logs / Baum (K5-Grenzen) ----------------------------------------------------------------------
  it("Frame: PNG-Größe kommt aus dem Bild, Ratebegrenzung liefert denselben Stand", async () => {
    const svc = makeSvc();
    const serial = await boot(svc);
    const f1 = await svc.frame(serial);
    expect(f1).toMatchObject({ width: 1080, height: 2400, geometryVersion: 1 });
    expect(f1!.seq).toBeGreaterThan(0);
    const f2 = await svc.frame(serial);
    expect(f2!.seq).toBe(f1!.seq); // innerhalb des Intervalls: gecacht, kein neues adb
  });

  it("Logs sind begrenzt und maskieren Träger-Token/Passwörter", async () => {
    const svc = makeSvc();
    const serial = await boot(svc);
    const logs = await svc.logs(serial, 1024);
    expect(logs.text).toContain("<redacted>");
    expect(logs.text).not.toContain("abcd1234567890");
    expect(logs.text).not.toContain("hunter2");
  });

  it("Baum extrahiert XML aus uiautomator-Ausgabe; kaputte Ausgabe failt laut", async () => {
    const svc = makeSvc();
    const serial = await boot(svc);
    const tree = await svc.tree(serial);
    expect(tree.xml.startsWith("<?xml")).toBe(true);
    expect(tree.xml.endsWith("</hierarchy>")).toBe(true);

    const svc2 = makeSvc();
    const serial2 = await boot(svc2);
    exec.respond = () => ({ code: 0, stdout: "kein xml hier" });
    await expect(svc2.tree(serial2)).rejects.toMatchObject({ code: "failed" });
  });

  // ---- T42.4: APK-Installation mit Hash ----------------------------------------------------------------------
  it("Installation nur mit übereinstimmendem Hash; falscher Hash blockiert vor adb", async () => {
    const svc = makeSvc();
    const serial = await boot(svc);
    const { generation } = await svc.acquireLease(serial, "sess-1", "mensch");
    const apk = join(dir, "app.apk");
    await writeFile(apk, "fake-apk-bytes");
    const sha = createHash("sha256").update("fake-apk-bytes").digest("hex");
    await expect(svc.installApk(serial, generation, apk, "f".repeat(64))).rejects.toMatchObject({ code: "blocked" });
    expect(exec.runs.some((r) => r.argv.includes("install"))).toBe(false);
    const ok = await svc.installApk(serial, generation, apk, sha);
    expect(ok.sha256).toBe(sha);
    expect(exec.runs.some((r) => r.argv.includes("install"))).toBe(true);
  });

  // ---- T42.4: Testläufe ---------------------------------------------------------------------------------------
  it("Testlauf: passed mit expectText aus dem Baum, Umgebungszeile hält API/Auflösung fest", async () => {
    const svc = makeSvc();
    const serial = await boot(svc);
    const run = await svc.runTest({ name: "PWA-Titel", serial, steps: [{ type: "openUrl", url: "http://10.0.2.2:3000/", timeoutMs: 5_000 }, { type: "expectText", text: "AncientVoid", timeoutMs: 2_000 }] }, "sess-1");
    expect(run.state).toBe("running");
    await waitUntil(() => svc.listTests(serial)[0]?.state === "passed");
    const done = svc.listTests(serial)[0]!;
    expect(done.env.apiVersion).toBe("35");
    expect(done.env.resolution).toEqual({ width: 1080, height: 2400 });
    expect(done.artifact?.name).toBeTruthy();
    expect(svc.artifactPath(serial, done.id)).toBeTruthy();
  });

  it("Testlauf: fehlender Text failed; aktive Menschen-Lease blockiert den Lauf (nie übernehmen)", async () => {
    const svc = makeSvc();
    const serial = await boot(svc);
    const { generation } = await svc.acquireLease(serial, "sess-1", "mensch");
    await expect(svc.runTest({ name: "x", serial, steps: [{ type: "expectText", text: "gibtsnicht", timeoutMs: 300 }] }, null)).rejects.toMatchObject({ code: "busy" });
    expect(svc.releaseLease(serial, generation).released).toBe(true);
    const run = await svc.runTest({ name: "gegenprobe", serial, steps: [{ type: "expectText", text: "gibtsnicht", timeoutMs: 300 }] }, null);
    expect(run.state).toBe("running");
    await waitUntil(() => svc.listTests(serial)[0]?.state === "failed");
    expect(svc.listTests(serial)[0]!.steps[0]!.detail).toContain("nicht im Accessibility-Baum");
  });

  it("Testlauf: Abbruch zwischen Schritten endet `aborted`", async () => {
    const svc = makeSvc();
    const serial = await boot(svc);
    const run = await svc.runTest({ name: "lang", serial, steps: [{ type: "wait", ms: 300 }, { type: "wait", ms: 5_000 }] }, null);
    await new Promise((r) => setTimeout(r, 100));
    expect(svc.abortTest(serial, run.id)).toBe(true);
    await waitUntil(() => svc.listTests(serial)[0]?.state === "aborted");
  });

  // ---- T42.5: Wiederanlauf (K7) --------------------------------------------------------------------------------
  it("Wiederanlauf: belegtes Eigentum wird adoptiert, fremdes nie; Lauf `running` ohne Prozess ist `unknown`", async () => {
    const svc = makeSvc();
    const serial = await boot(svc);
    const { generation } = await svc.acquireLease(serial, "sess-1", "mensch");
    // Lauf anleiern, der „hängt“: running im Journal ohne lebenden Test.
    const { appendFileSync } = await import("node:fs");
    appendFileSync(join(dir, "devices", "tests.jsonl"), `${JSON.stringify({ id: "alte-id", serial, sessionId: null, name: "alt", state: "running", startedAt: "2026-01-01T00:00:00Z", finishedAt: null, steps: [], env: { avdName: null, apiVersion: null, buildFingerprint: null, resolution: null, orientation: null, apkSha256: null }, artifact: null, note: null })}\n`);

    // Neustart: neuer Service über demselben Datadir; der Fake-Prozess lebt weiter mit Marker.
    const svc2 = makeSvc();
    await waitUntil(async () => (await svc2.status()).devices.some((d) => d.serial === serial && d.owned));
    await waitUntil(async () => (await svc2.status()).devices.find((d) => d.serial === serial)?.instance?.state === "ready");
    // Eingaben werden NIE wiederholt: die alte Lease existiert nicht mehr, die Generation ist höher.
    const fresh = await svc2.acquireLease(serial, "sess-1", "mensch");
    expect(fresh.generation).toBeGreaterThan(generation);
    const old = svc2.listTests(serial).find((r) => r.id === "alte-id")!;
    expect(old.state).toBe("unknown");
    expect(old.note).toContain("nichts wird wiederholt");
  });

  it("Wiederanlauf: nicht mehr nachweisbar eigener Prozess wird nicht adoptiert", async () => {
    const svc = makeSvc();
    const serial = await boot(svc);
    await svc.stopEmulator(serial); // SIGTERM → Prozess weg + Journal `stopped`
    const svc2 = makeSvc();
    await new Promise((r) => setTimeout(r, 150)); // Recovery läuft async
    const st = await svc2.status();
    expect(st.devices.some((d) => d.owned)).toBe(false);
  });

  // ---- Reaper ---------------------------------------------------------------------------------------------------
  it("Reaper: Lease nach Ruhe (Stream getrennt) wird freigegeben; beendete Session verliert die Lease", async () => {
    const svc = makeSvc({ leaseIdleMs: 60, reapIntervalMs: 50 });
    const serial = await boot(svc);
    await svc.acquireLease(serial, "sess-1", "mensch");
    await waitUntil(async () => (await svc.status()).leases.length === 0);

    const svc2 = makeSvc({ leaseIdleMs: 60_000, isActive: () => false, reapIntervalMs: 50 });
    const serial2 = await boot(svc2);
    await svc2.acquireLease(serial2, "tot", "mensch");
    await waitUntil(async () => (await svc2.status()).leases.length === 0); // Session inaktiv → Reaper befreit
  });
});
