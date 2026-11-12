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
