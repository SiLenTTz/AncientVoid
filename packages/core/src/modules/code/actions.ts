import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { ACTION_OUTPUT_MAX_CHARS, ActionDefinition, ActionParam, actionArgv, type ActionRun, type EmittedEvent } from "@ancientvoid/contracts";

/** Read-only git actions every worktree has. */
export const BUILTIN_ACTIONS: ActionDefinition[] = [
  ActionDefinition.parse({ id: "git-status", label: "Git-Status", kind: "git", source: "Git", argv: ["git", "status", "--short", "--branch"], readOnly: true, timeoutMs: 30_000 }),
  ActionDefinition.parse({ id: "git-log", label: "Letzte Commits", kind: "git", source: "Git", argv: ["git", "log", "--oneline", "-n", "15"], readOnly: true, timeoutMs: 30_000 }),
  ActionDefinition.parse({ id: "git-diff-stat", label: "Änderungen (Statistik)", kind: "git", source: "Git", argv: ["git", "diff", "--stat", "HEAD"], readOnly: true, timeoutMs: 30_000 }),
];

/** Namen, die ein Skript-/Make-Ziel tragen darf — nie mit „-“ beginnen, sonst läse sie das Werkzeug als Option. */
const SAFE_NAME = /^[A-Za-z0-9_][\w:.@/-]{0,80}$/;

function slug(prefix: string, name: string): string {
  return `${prefix}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`.slice(0, 41).replace(/-+$/, "");
}

/**
 * Befehle, die das Repo selbst deklariert: `package.json` scripts, `Makefile`-Ziele, `justfile`-Rezepte,
 * ausführbare Dateien in `scripts/` und `bin/` sowie pytest. Nichts wird geraten; jede Aktion läuft ohne
 * Shell als argv im Worktree.
 */
export async function detectedActions(root: string): Promise<ActionDefinition[]> {
  const out: ActionDefinition[] = [];
  const seen = new Set<string>();
  const add = (def: { id: string; label: string; kind: "test" | "tool"; source: string; argv: string[]; params?: ActionDefinition["params"] }) => {
    let id = def.id;
    for (let n = 2; seen.has(id); n++) id = `${def.id.slice(0, 38)}-${n}`;
    seen.add(id);
    // Werkzeug-Skripte können Server, Emulatoren oder Apps starten — dafür kein Zeitlimit, aber „Stoppen“.
    out.push(ActionDefinition.parse({ ...def, id, label: def.label.slice(0, 60), longRunning: def.kind === "tool" }));
  };
  const isTest = (name: string) => /^(test|spec|e2e|check|lint|typecheck|gate)/i.test(name);

  const pkg = await readFile(join(root, "package.json"), "utf8").then((t) => JSON.parse(t) as { scripts?: Record<string, string> }).catch(() => null);
  for (const name of Object.keys(pkg?.scripts ?? {})) {
    if (!SAFE_NAME.test(name)) continue;
    const argv = name === "test" ? ["npm", "test"] : ["npm", "run", name];
    add({ id: name === "test" ? "npm-test" : slug("npm", name), label: argv.join(" "), kind: isTest(name) ? "test" : "tool", source: "package.json", argv });
  }

  const makefile = await readFile(join(root, "Makefile"), "utf8").catch(() => "");
  for (const m of makefile.matchAll(/^([A-Za-z0-9_][\w.-]*):(?![=])/gm)) {
    if (m[1]!.startsWith(".")) continue;
    add({ id: slug("make", m[1]!), label: `make ${m[1]}`, kind: isTest(m[1]!) ? "test" : "tool", source: "Makefile", argv: ["make", m[1]!] });
  }

  const justfile = await readFile(join(root, "justfile"), "utf8").catch(() => readFile(join(root, "Justfile"), "utf8").catch(() => ""));
  for (const m of justfile.matchAll(/^([a-z][\w-]*)\s*:(?![=])/gm)) {
    add({ id: slug("just", m[1]!), label: `just ${m[1]}`, kind: isTest(m[1]!) ? "test" : "tool", source: "justfile", argv: ["just", m[1]!] });
  }

  for (const dir of ["scripts", "bin"]) {
    const names = await readdir(join(root, dir)).catch(() => [] as string[]);
    for (const name of names.sort().slice(0, 60)) {
      if (!SAFE_NAME.test(name)) continue;
      // stat folgt Symlinks nicht heraus aus dem Worktree: nur reguläre, ausführbare Dateien zählen.
      const info = await stat(join(root, dir, name)).catch(() => null);
      if (!info?.isFile() || (info.mode & 0o111) === 0) continue;
      add({ id: slug(dir, name), label: `${dir}/${name}`, kind: isTest(name) ? "test" : "tool", source: `${dir}/`, argv: [`./${dir}/${name}`] });
    }
  }

  const pyproject = await readFile(join(root, "pyproject.toml"), "utf8").catch(() => "");
  const pytestIni = await readFile(join(root, "pytest.ini"), "utf8").then(() => true, () => false);
  if (pytestIni || pyproject.includes("[tool.pytest")) {
    add({
      id: "pytest",
      label: "pytest",
      kind: "test",
      source: "pytest",
      argv: ["python3", "-m", "pytest", "-q", "{path}"],
      params: { path: ActionParam.parse({ description: "Test-Datei oder -Ordner (optional)", optional: true }) },
    });
  }
  return out;
}

/**
 * Variablen, mit denen ein vom Hub gestartetes Programm ein Fenster auf dem Desktop dieses Rechners öffnen kann
 * (Browser, Emulator, Electron, `docker`-GUIs). Ein Hub unter systemd --user oder im Terminal ohne Sitzung trägt sie
 * oft nicht; fehlende Werte werden aus dem Laufzeitverzeichnis der Sitzung erschlossen, vorhandene nie überschrieben.
 */
export function desktopEnv(base: NodeJS.ProcessEnv, dirs: { runtime?: string; x11?: string } = {}): Record<string, string> {
  const add: Record<string, string> = {};
  const uid = process.getuid?.();
  const runtime = base.XDG_RUNTIME_DIR ?? dirs.runtime ?? (uid !== undefined ? `/run/user/${uid}` : undefined);
  if (runtime && existsSync(runtime)) {
    if (!base.XDG_RUNTIME_DIR) add.XDG_RUNTIME_DIR = runtime;
    if (!base.WAYLAND_DISPLAY) {
      const socket = readdirSync(runtime).filter((n) => /^wayland-\d+$/.test(n)).sort()[0];
      if (socket) add.WAYLAND_DISPLAY = socket;
    }
    if (!base.DBUS_SESSION_BUS_ADDRESS && existsSync(join(runtime, "bus"))) add.DBUS_SESSION_BUS_ADDRESS = `unix:path=${join(runtime, "bus")}`;
  }
  if (!base.DISPLAY) {
    const x11 = dirs.x11 ?? "/tmp/.X11-unix";
    const sock = existsSync(x11) ? readdirSync(x11).filter((n) => /^X\d+$/.test(n)).sort()[0] : undefined;
    if (sock) add.DISPLAY = `:${sock.slice(1)}`;
  }
  return add;
}

export interface ActionRunnerDeps {
  /** Timeline events for the session (only live sessions take them). */
  record: (sessionId: string, events: EmittedEvent[]) => Promise<unknown>;
  now?: () => Date;
}

const EVENT_OUTPUT_JSON = 3000;

/** The end of the output that fits into an event: ≤ 3000 chars as JSON
 * (escaped newlines and control characters count), K5. */
function eventTail(output: string): string {
  let tail = output;
  while (JSON.stringify(tail).length > EVENT_OUTPUT_JSON) tail = tail.slice(Math.ceil(tail.length / 4));
  return tail === output ? output : `…${tail}`;
}
const RUNS_PER_SESSION = 20;
const MAX_PARALLEL = 4;
const STOP_GRACE_MS = 5000;

/**
 * T7.6: runs a registered action in a session's worktree — argv without a
 * shell, one at a time per session, with a timeout that ends the whole
 * process group. The output tail stays on the run; the timeline gets a
 * tool_use/tool_result pair (≤ 4 KB, K5).
 */
export class ActionRunner {
  private readonly deps: ActionRunnerDeps;
  private readonly runs = new Map<string, ActionRun[]>();
  private readonly stoppers = new Map<string, () => void>();

  constructor(deps: ActionRunnerDeps) {
    this.deps = deps;
  }

  list(sessionId: string): ActionRun[] {
    return [...(this.runs.get(sessionId) ?? [])].reverse();
  }

  get(sessionId: string, runId: string): ActionRun | undefined {
    return this.runs.get(sessionId)?.find((r) => r.id === runId);
  }

  /** Beendet einen laufenden Befehl samt Kindprozessen; false, wenn er nicht (mehr) läuft. */
  stop(sessionId: string, runId: string): boolean {
    const run = this.get(sessionId, runId);
    const stopper = this.stoppers.get(runId);
    if (run?.status !== "running" || !stopper) return false;
    stopper();
    return true;
  }

  /** CI=1 nur für Tests/Git: Werkzeuge, die einen Browser oder ein Fenster öffnen sollen, brauchen die Desktop-Variablen statt CI. */
  private envFor(def: ActionDefinition): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, FORCE_COLOR: "0" };
    if (def.kind !== "tool") env.CI = "1";
    return def.longRunning || def.kind === "tool" ? { ...env, ...desktopEnv(env) } : env;
  }

  /** Starts the action; resolves with the run once it has started. */
  async start(sessionId: string, workdir: string, def: ActionDefinition, params: Record<string, string | undefined>, actor: string | null): Promise<ActionRun> {
    const active = this.list(sessionId).filter((r) => r.status === "running");
    if (active.some((r) => r.actionId === def.id)) throw new Error(`„${def.label}“ läuft schon — erst stoppen oder abwarten.`);
    if (active.length >= MAX_PARALLEL) throw new Error(`In dieser Session laufen schon ${MAX_PARALLEL} Befehle — erst einen stoppen.`);
    const argv = actionArgv(def, params);
    const now = this.deps.now ?? (() => new Date());
    const run: ActionRun = {
      id: randomUUID(),
      sessionId,
      actionId: def.id,
      argv,
      status: "running",
      exitCode: null,
      startedAt: now().toISOString(),
      endedAt: null,
      actor,
      output: "",
      outputTruncated: false,
    };
    const list = this.runs.get(sessionId) ?? [];
    list.push(run);
    if (list.length > RUNS_PER_SESSION) list.splice(0, list.length - RUNS_PER_SESSION);
    this.runs.set(sessionId, list);
    await this.deps.record(sessionId, [
      { type: "tool_use", summary: `${def.label}: ${argv.join(" ")}`.slice(0, 200), payload: { id: run.id, name: `aktion:${def.id}`, input: { argv, kind: def.kind, actor }, kind: "action.run" } },
    ]);

    const child = spawn(argv[0]!, argv.slice(1), { cwd: workdir, detached: true, stdio: ["ignore", "pipe", "pipe"], env: this.envFor(def) });
    const append = (chunk: Buffer) => {
      run.output += chunk.toString("utf8");
      if (run.output.length > ACTION_OUTPUT_MAX_CHARS) {
        run.output = run.output.slice(-ACTION_OUTPUT_MAX_CHARS);
        run.outputTruncated = true;
      }
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    let timedOut = false;
    let stopped = false;
    const signal = (sig: NodeJS.Signals) => {
      try {
        process.kill(-child.pid!, sig);
      } catch {
        child.kill(sig);
      }
    };
    const timer = def.longRunning
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          signal("SIGKILL");
        }, def.timeoutMs);
    timer?.unref();
    // Stoppen: erst höflich (SIGTERM an die ganze Gruppe — `docker compose up` räumt dabei auf), dann hart.
    this.stoppers.set(run.id, () => {
      stopped = true;
      signal("SIGTERM");
      setTimeout(() => run.status === "running" && signal("SIGKILL"), STOP_GRACE_MS).unref();
    });
    const finish = (code: number | null, error?: string) => {
      clearTimeout(timer);
      this.stoppers.delete(run.id);
      if (run.status !== "running") return;
      if (error) append(Buffer.from(`\n${error}\n`));
      run.exitCode = code;
      run.status = timedOut ? "timeout" : stopped ? "stopped" : code === 0 ? "succeeded" : "failed";
      run.endedAt = now().toISOString();
      const tail = eventTail(run.output);
      const label = run.status === "succeeded" ? "erfolgreich" : run.status === "stopped" ? "gestoppt" : run.status === "timeout" ? `abgebrochen nach ${Math.round(def.timeoutMs / 1000)} s` : `fehlgeschlagen (Code ${code ?? "?"})`;
      void this.deps
        .record(sessionId, [
          { type: "tool_result", summary: `${def.label}: ${label}`.slice(0, 200), payload: { toolUseId: run.id, name: `aktion:${def.id}`, isError: run.status !== "succeeded", content: tail, kind: "action.result", status: run.status, exitCode: code } },
        ])
        .catch(() => undefined);
    };
    child.on("error", (err) => finish(null, err.message));
    child.on("close", (code) => finish(code));
    return run;
  }
}
