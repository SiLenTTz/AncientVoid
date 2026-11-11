import { spawn } from "node:child_process";
import type { WorkerProcess, WorkerRunner, WorkerInfo, WorkerSpec } from "@ancientvoid/contracts";

/**
 * Plain child_process WorkerRunner — fallback for systems without tmux
 * (premortem P0-2: tmux stays behind an interface; e.g. constrained WSL or
 * container setups). Workers do not survive a hub restart in this runner.
 */
export class ProcessRunner implements WorkerRunner {
  readonly kind = "process";

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async spawn(spec: WorkerSpec): Promise<WorkerProcess> {
    const proc = spawn(spec.cmd[0]!, spec.cmd.slice(1), {
      cwd: spec.cwd,
      env: { ...process.env, ...spec.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdoutCbs = new Set<(chunk: string) => void>();
    const stderrCbs = new Set<(chunk: string) => void>();
    const exitCbs = new Set<(code: number | null) => void>();
    proc.stdout.on("data", (d: Buffer) => {
      for (const cb of stdoutCbs) cb(d.toString("utf8"));
    });
    proc.stderr.on("data", (d: Buffer) => {
      for (const cb of stderrCbs) cb(d.toString("utf8"));
    });
    // BUG-0119: schließt das Kind seine Eingabe, kommt EPIPE asynchron als 'error' — ohne Handler beendet
    // das den ganzen Hub. Sichtbar machen statt abstürzen oder still verwerfen (fail loud).
    const stdinFailed = (reason: string) => {
      for (const cb of stderrCbs) cb(`stdin: ${reason}\n`);
    };
    proc.stdin.on("error", (err) => stdinFailed(err.message));
    proc.on("exit", (code) => {
      for (const cb of exitCbs) cb(code);
    });
    return {
      ...(proc.pid !== undefined ? { pid: proc.pid } : {}),
      onStdout: (cb) => stdoutCbs.add(cb),
      onStderr: (cb) => stderrCbs.add(cb),
      onExit: (cb) => exitCbs.add(cb),
      write: (data) => {
        if (proc.stdin.destroyed || !proc.stdin.writable) return stdinFailed("Prozess nimmt keine Eingabe mehr an");
        proc.stdin.write(data);
      },
      kill: async (signal) => {
        proc.kill(signal ?? "SIGTERM");
      },
      exited: () =>
        new Promise((resolve) => {
          if (proc.exitCode !== null) resolve({ code: proc.exitCode });
          else proc.on("exit", (code) => resolve({ code }));
        }),
    };
  }

  async list(): Promise<WorkerInfo[]> {
    return [];
  }

  async killByName(): Promise<void> {
    // not tracked — process handles are managed via WorkerProcess.kill
  }

  async reapOrphans(): Promise<string[]> {
    return [];
  }
}
