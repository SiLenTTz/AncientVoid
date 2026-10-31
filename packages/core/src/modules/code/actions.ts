import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ACTION_OUTPUT_MAX_CHARS, ActionDefinition, actionArgv, type ActionRun, type EmittedEvent } from "@ancientvoid/contracts";

/** Read-only git actions every worktree has. */
export const BUILTIN_ACTIONS: ActionDefinition[] = [
  ActionDefinition.parse({ id: "git-status", label: "Git-Status", kind: "git", argv: ["git", "status", "--short", "--branch"], readOnly: true, timeoutMs: 30_000 }),
  ActionDefinition.parse({ id: "git-log", label: "Letzte Commits", kind: "git", argv: ["git", "log", "--oneline", "-n", "15"], readOnly: true, timeoutMs: 30_000 }),
  ActionDefinition.parse({ id: "git-diff-stat", label: "Änderungen (Statistik)", kind: "git", argv: ["git", "diff", "--stat", "HEAD"], readOnly: true, timeoutMs: 30_000 }),
];

/**
 * Test actions the project itself declares — `package.json` `scripts.test`
 * and a pytest setup. Nothing is guessed beyond these two conventions.
 */
export async function detectedActions(root: string): Promise<ActionDefinition[]> {
  const out: ActionDefinition[] = [];
  const pkg = await readFile(join(root, "package.json"), "utf8").then((t) => JSON.parse(t) as { scripts?: Record<string, string> }).catch(() => null);
  if (pkg?.scripts?.test) out.push(ActionDefinition.parse({ id: "npm-test", label: "npm test", kind: "test", argv: ["npm", "test"] }));
  const pyproject = await readFile(join(root, "pyproject.toml"), "utf8").catch(() => "");
  const pytestIni = await readFile(join(root, "pytest.ini"), "utf8").then(() => true, () => false);
  if (pytestIni || pyproject.includes("[tool.pytest")) {
    out.push(
      ActionDefinition.parse({
        id: "pytest",
        label: "pytest",
        kind: "test",
        argv: ["python3", "-m", "pytest", "-q", "{path}"],
        params: { path: { description: "Test-Datei oder -Ordner (optional)", optional: true } },
      }),
    );
  }
  return out;
}

export interface ActionRunnerDeps {
  /** Timeline events for the session (only live sessions take them). */
  record: (sessionId: string, events: EmittedEvent[]) => Promise<unknown>;
  now?: () => Date;
}

const EVENT_OUTPUT_JSON = 3000;

/** The end of the output that fits into an event: ≤ 3000 chars as JSON
 * (escaped newlines and control characters count), K5. */
export function eventTail(output: string): string {
  let tail = output;
  while (JSON.stringify(tail).length > EVENT_OUTPUT_JSON) tail = tail.slice(Math.ceil(tail.length / 4));
  return tail === output ? output : `…${tail}`;
}
const RUNS_PER_SESSION = 20;

/**
 * T7.6: runs a registered action in a session's worktree — argv without a
 * shell, one at a time per session, with a timeout that ends the whole
 * process group. The output tail stays on the run; the timeline gets a
 * tool_use/tool_result pair (≤ 4 KB, K5).
 */
export class ActionRunner {
  private readonly deps: ActionRunnerDeps;
  private readonly runs = new Map<string, ActionRun[]>();

  constructor(deps: ActionRunnerDeps) {
    this.deps = deps;
  }

  list(sessionId: string): ActionRun[] {
    return [...(this.runs.get(sessionId) ?? [])].reverse();
  }

  get(sessionId: string, runId: string): ActionRun | undefined {
    return this.runs.get(sessionId)?.find((r) => r.id === runId);
  }

  /** Starts the action; resolves with the run once it has started. */
  async start(sessionId: string, workdir: string, def: ActionDefinition, params: Record<string, string | undefined>, actor: string | null): Promise<ActionRun> {
    if (this.list(sessionId).some((r) => r.status === "running")) throw new Error("In dieser Session läuft schon eine Aktion.");
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

    const child = spawn(argv[0]!, argv.slice(1), { cwd: workdir, detached: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CI: "1", FORCE_COLOR: "0" } });
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
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, def.timeoutMs);
    timer.unref();
    const finish = (code: number | null, error?: string) => {
      clearTimeout(timer);
      if (run.status !== "running") return;
      if (error) append(Buffer.from(`\n${error}\n`));
      run.exitCode = code;
      run.status = timedOut ? "timeout" : code === 0 ? "succeeded" : "failed";
      run.endedAt = now().toISOString();
      const tail = eventTail(run.output);
      const label = run.status === "succeeded" ? "erfolgreich" : run.status === "timeout" ? `abgebrochen nach ${Math.round(def.timeoutMs / 1000)} s` : `fehlgeschlagen (Code ${code ?? "?"})`;
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
