import { afterEach, describe, expect, it } from "vitest";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dirs = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function fixture(dataDir) {
  const root = mkdtempSync(join(tmpdir(), "av-setup-"));
  dirs.push(root);
  for (const dir of ["bin", "apps/hubctl/src"]) mkdirSync(join(root, dir), { recursive: true });
  copyFileSync(join(repo, "setup.sh"), join(root, "setup.sh"));
  // Nur Installation ersetzen: der Wizard und hubctl samt SQLite laufen echt.
  writeFileSync(join(root, "bin/npm"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  cpSync(join(repo, "apps/hubctl/src"), join(root, "apps/hubctl/src"), { recursive: true });
  symlinkSync(join(repo, "node_modules"), join(root, "node_modules"));
  writeFileSync(join(root, "hub.config.json"), JSON.stringify({ ...(dataDir ? { dataDir } : {}), adapters: [{ id: "dummy" }] }));
  return root;
}

function run(root, args = []) {
  const result = spawnSync("bash", ["setup.sh", "--yes", "--adapter=dummy", "--device-label=setup-test", "--no-pwa", "--no-start", ...args], {
    cwd: root, env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}` }, encoding: "utf8", timeout: 20_000,
  });
  // stdout enthält einmalige Tokens; bei Fehlern nur stderr ausgeben.
  expect(result.status, result.stderr).toBe(0);
}

function labels(db) {
  const dbFile = new DatabaseSync(db, { readOnly: true });
  try { return dbFile.prepare("SELECT label FROM device_tokens ORDER BY label").all().map((row) => row.label); }
  finally { dbFile.close(); }
}

describe("setup: Tokens gehören zum konfigurierten Hub (BUG-0130)", () => {
  it.each([undefined, "state with spaces"])("Datenpfad %s und wiederholter Device-Setup", (dataDir) => {
    const root = fixture(dataDir);
    const target = join(root, dataDir ?? "data");
    const config = readFileSync(join(root, "hub.config.json"), "utf8");
    run(root, ["--voidwarden"]);
    expect(existsSync(join(target, "hub.db"))).toBe(true);
    expect(existsSync(join(target, ".setup-first-token"))).toBe(true);
    expect(labels(join(target, "hub.db"))).toEqual(["agent:voidwarden", "display:web-1", "setup-test"]);
    run(root);
    expect(labels(join(target, "hub.db"))).toHaveLength(3);
    expect(readFileSync(join(root, "hub.config.json"), "utf8")).toBe(config);
  });

  it("absoluter Datenpfad ignoriert einen Marker der früheren Default-DB", () => {
    const target = mkdtempSync(join(tmpdir(), "av-data-"));
    dirs.push(target);
    const root = fixture(target);
    mkdirSync(join(root, "data"));
    writeFileSync(join(root, "data/.setup-first-token"), "");
    run(root);
    expect(existsSync(join(target, "hub.db"))).toBe(true);
    expect(labels(join(target, "hub.db"))).toEqual(["setup-test"]);
    expect(existsSync(join(root, "data/hub.db"))).toBe(false);
  });
});

describe("setup: OpenAI-Eingaben werden sauber serialisiert und früh geprüft (BUG-0134)", () => {
  function openaiFixture() {
    const root = fixture();
    rmSync(join(root, "hub.config.json"));
    mkdirSync(join(root, "apps/hub"), { recursive: true });
    copyFileSync(join(repo, "apps/hub/hub.config.example.json"), join(root, "apps/hub/hub.config.example.json"));
    return root;
  }
  const wizard = (root, args) => spawnSync("bash", ["setup.sh", "--yes", "--adapter=openai", "--device-label=setup-test", "--no-pwa", "--no-start", ...args], {
    cwd: root, env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}` }, encoding: "utf8", timeout: 20_000,
  });

  it.each(['a"b', "a\\b", "qwen2.5-coder:7b"])("Modell %s landet unverändert in hub.config.json", (model) => {
    const root = openaiFixture();
    const result = wizard(root, ["--base-url=http://127.0.0.1:8080/v1", `--model=${model}`]);
    expect(result.status, result.stderr).toBe(0);
    const local = JSON.parse(readFileSync(join(root, "hub.config.json"), "utf8")).adapters.find((a) => a.id === "local-llm");
    expect(local.config).toEqual({ baseUrl: "http://127.0.0.1:8080/v1", model });
  });

  it.each([
    ["Zeilenumbruch im Modell", ["--base-url=http://127.0.0.1:8080/v1", "--model=a\nb"], /Modell/],
    ["leeres Modell", ["--base-url=http://127.0.0.1:8080/v1", "--model= "], /Modell/],
    ["URL ohne Schema", ["--base-url=localhost:8080/v1", "--model=m"], /baseUrl/],
  ])("%s: Exit 2 mit klarer Meldung, keine Config", (_name, args, message) => {
    const root = openaiFixture();
    const result = wizard(root, args);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(message);
    expect(result.stderr).not.toMatch(/SyntaxError/);
    expect(existsSync(join(root, "hub.config.json"))).toBe(false);
  });
});

describe("setup: --voidwarden ist wiederholbar (BUG-0135)", () => {
  it("ein zweiter Lauf stellt keine weiteren VoidWarden-Tokens aus und sagt, wie man bewusst neu ausstellt", () => {
    const root = fixture();
    run(root, ["--voidwarden"]);
    const second = spawnSync("bash", ["setup.sh", "--yes", "--adapter=dummy", "--device-label=setup-test", "--no-pwa", "--no-start", "--voidwarden"], {
      cwd: root, env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}` }, encoding: "utf8", timeout: 20_000,
    });
    expect(second.status, second.stderr).toBe(0);
    expect(labels(join(root, "data/hub.db"))).toEqual(["agent:voidwarden", "display:web-1", "setup-test"]);
    expect(second.stdout).toMatch(/token revoke agent:voidwarden/);
    expect(second.stdout).not.toMatch(/shown once/);
  });
});

describe("setup: Node-Matrix ^22.18 || ^24 || >=26 (BUG-0133)", () => {
  // Stand-in meldet nur die Version und reicht alles andere an das echte node weiter.
  function withNode(version) {
    const root = fixture();
    writeFileSync(join(root, "bin/node"), `#!/bin/sh\n[ "$1" = "--version" ] && { echo ${version}; exit 0; }\nexec "${process.execPath}" "$@"\n`, { mode: 0o755 });
    return spawnSync("bash", ["setup.sh", "--yes", "--adapter=dummy", "--device-label=setup-test", "--no-pwa", "--no-start"], {
      cwd: root, env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}` }, encoding: "utf8", timeout: 20_000,
    });
  }

  it.each(["v22.17.1", "v23.11.0", "v25.2.0", "v20.19.0"])("%s wird mit Exit 2 abgelehnt", (version) => {
    const result = withNode(version);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/22\.18/);
  });

  it.each(["v22.18.0", "v24.0.0", "v26.7.0"])("%s wird akzeptiert", (version) => {
    const result = withNode(version);
    expect(result.status, result.stderr).toBe(0);
  });

  it("package.json engines nennt dieselbe Matrix", () => {
    expect(JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).engines.node).toBe("^22.18.0 || ^24.0.0 || >=26.0.0");
  });
});

describe("setup: einen laufenden Hub nur mit belegter Identität übernehmen (BUG-0132)", () => {
  const pids = [];
  const roots = [];
  afterEach(() => {
    for (const pid of pids.splice(0)) { try { process.kill(pid, "SIGTERM"); } catch { /* schon beendet */ } }
    for (const root of roots.splice(0)) {
      const id = spawnSync("bash", ["-c", "printf '%s' \"$PWD\" | cksum | cut -d' ' -f1"], { cwd: root, encoding: "utf8" }).stdout.trim();
      for (const ext of ["pid", "log"]) rmSync(join(tmpdir(), `ancientvoid-hub-${id}.${ext}`), { force: true });
    }
  });

  // Stub-Hub: liest Port/dataDir aus ANCIENTVOID_CONFIG, schreibt die echte PID-Sperre und meldet /api/ready.
  const STUB_HUB = `import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
const cfg = JSON.parse(readFileSync(process.env.ANCIENTVOID_CONFIG, "utf8"));
const dataDir = resolve(cfg.dataDir ?? "./data");
mkdirSync(dataDir, { recursive: true });
writeFileSync(resolve(dataDir, ".ancientvoid-hub.pid"), "hub:" + process.pid + "\\n");
createServer((_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end('{"ok":true}'); }).listen(cfg.server.port, "127.0.0.1");
`;

  async function freePort() {
    const { createServer } = await import("node:net");
    return new Promise((done) => { const s = createServer().listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => done(port)); }); });
  }

  function checkout(port) {
    const root = fixture();
    writeFileSync(join(root, "hub.config.json"), JSON.stringify({ server: { port }, adapters: [{ id: "dummy" }] }));
    mkdirSync(join(root, "apps/hub/src"), { recursive: true });
    writeFileSync(join(root, "apps/hub/src/main.ts"), STUB_HUB);
    mkdirSync(join(root, "scripts"));
    copyFileSync(join(repo, "scripts/hub.sh"), join(root, "scripts/hub.sh"));
    roots.push(root);
    return root;
  }

  const wizard = (root) => spawnSync("bash", ["setup.sh", "--yes", "--adapter=dummy", "--device-label=setup-test", "--no-pwa"], {
    cwd: root, env: { ...process.env, ANCIENTVOID_CONFIG: "", PATH: `${join(root, "bin")}:${process.env.PATH}` }, encoding: "utf8", timeout: 40_000,
  });
  const lockPid = (root) => Number(readFileSync(join(root, "data/.ancientvoid-hub.pid"), "utf8").trim().replace("hub:", ""));

  it("zwei Checkouts auf zwei Ports starten je ihren eigenen Hub; ein Wiederholungslauf übernimmt den eigenen", async () => {
    const a = checkout(await freePort());
    const b = checkout(await freePort());
    const first = wizard(a);
    if (existsSync(join(a, "data/.ancientvoid-hub.pid"))) pids.push(lockPid(a));
    expect(first.status, first.stderr).toBe(0);
    const second = wizard(b);
    if (existsSync(join(b, "data/.ancientvoid-hub.pid"))) pids.push(lockPid(b));
    expect(second.status, second.stdout + second.stderr).toBe(0);
    expect(lockPid(a)).not.toBe(lockPid(b));
    const again = wizard(a);
    expect(again.status, again.stderr).toBe(0);
    expect(again.stdout).toMatch(/eigener Hub läuft bereits/);
  });

  it("ein fremder Hub auf dem Port ist ein Konflikt: Exit 6, kein Token, kein Start", async () => {
    const port = await freePort();
    const foreign = checkout(port);
    const started = spawnSync("bash", ["scripts/hub.sh", "start"], { cwd: foreign, env: { ...process.env, HUB_LOCAL: "1", ANCIENTVOID_CONFIG: join(foreign, "hub.config.json") }, encoding: "utf8", timeout: 20_000 });
    expect(started.status, started.stdout + started.stderr).toBe(0);
    pids.push(lockPid(foreign));
    const mine = checkout(port);
    const result = wizard(mine);
    expect(result.status).toBe(6);
    expect(result.stderr).toMatch(/nicht nachweislich zu diesem Checkout/);
    expect(existsSync(join(mine, "data/hub.db"))).toBe(false);
    expect(existsSync(join(mine, "data/.setup-first-token"))).toBe(false);
  });
});

describe("setup: Abschlussblock nennt den Handy-Weg (ADR-0073, P57 T57.8)", () => {
  it("nennt Tailnet-Skript samt Port und Token-Eingabe, nie ein Token in einer URL", () => {
    const root = fixture();
    const result = spawnSync("bash", ["setup.sh", "--yes", "--adapter=dummy", "--device-label=setup-test", "--no-pwa", "--no-start"], {
      cwd: root, env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}` }, encoding: "utf8", timeout: 20_000,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/setup-tailscale-serve\.sh 7373 druckt die https-URL/);
    expect(result.stdout).toMatch(/Device-Token eingeben/);
    expect(result.stdout).not.toMatch(/https?:\/\/\S*[?&#]token=/i);
  });
});

describe("setup: Projektwurzeln für die erste Session (BUG-0153)", () => {
  function fresh() {
    const root = fixture();
    rmSync(join(root, "hub.config.json"));
    mkdirSync(join(root, "apps/hub"), { recursive: true });
    copyFileSync(join(repo, "apps/hub/hub.config.example.json"), join(root, "apps/hub/hub.config.example.json"));
    return root;
  }
  const projectRoots = (root) => JSON.parse(readFileSync(join(root, "hub.config.json"), "utf8")).projectRoots;
  const wizard = (root, args = []) => spawnSync("bash", ["setup.sh", "--yes", "--adapter=dummy", "--device-label=setup-test", "--no-pwa", "--no-start", ...args], {
    cwd: root, env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}` }, encoding: "utf8", timeout: 20_000,
  });

  it("--projects=<dir> landet absolut in der neuen Config", () => {
    const root = fresh();
    const repos = mkdtempSync(join(tmpdir(), "av-repos-"));
    dirs.push(repos);
    run(root, [`--projects=${repos}`]);
    expect(projectRoots(root)).toEqual([repos]);
  });

  it("--yes ohne --projects bleibt kopflos und sagt ehrlich, was fehlt", () => {
    const root = fresh();
    const result = wizard(root);
    expect(result.status, result.stderr).toBe(0);
    expect(projectRoots(root)).toEqual([]);
    expect(result.stdout).toMatch(/projectRoots: \(leer\)[\s\S]*--projects=/);
  });

  it("ein noch fehlender Ordner wird eingetragen und als Hinweis genannt", () => {
    const root = fresh();
    const missing = join(root, "gibt-es-noch-nicht");
    const result = wizard(root, [`--projects=${missing}`]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toMatch(/existiert \(noch\) nicht/);
    expect(projectRoots(root)).toEqual([missing]);
  });
});
