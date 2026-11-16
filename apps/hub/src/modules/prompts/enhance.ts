import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * T1.5-8 — prompt enhancer. Design decision (EPIC-P1.5 §3.4), made with
 * real measurements, not a guess:
 *
 *   (a) the currently-selected coding adapter itself, via a quick
 *       throwaway call — CHOSEN.
 *   (b) a separate local model — REJECTED for now: no such infrastructure
 *       exists anywhere in this repo (P3 §3 envisioned a local
 *       Qwen fine-tune that was never built), so there is nothing to
 *       measure it against. (a) is the only option with a real number
 *       behind it today.
 *
 * Real measurement, claude (2026-09-16, this session, claude-sonnet-5,
 * `claude -p ... --output-format json --tools "" --dangerously-skip-permissions`):
 * 6617ms wall time, $0.065402 for one rewrite of a short raw prompt. That
 * is a real, non-trivial quota cost per click — which is exactly why the
 * result carries its own cost/latency back to the caller instead of
 * silently succeeding. It is NOT folded into ADR-0004's per-adapter usage
 * cache: doing so would require running this one-shot call through the
 * full streaming adapter pipeline (stream-json + normalize.ts's
 * rate_limit_event parsing) that a lightweight utility call doesn't
 * otherwise need — claude's non-streaming `--output-format json` (used
 * here for simplicity) doesn't even carry a rate_limit_event at all, only
 * the streaming format does. Shown at the point of use instead (T1.5-8's
 * UI), a deliberate scope line, not a silent gap.
 *
 * codex: attempted the same real measurement on 2026-09-16 and hit a real
 * "you've hit your usage limit" account-level error (itself a genuine,
 * unplanned demonstration of exactly the quota-exhaustion scenario
 * ADR-0004 exists to surface) — no real codex latency/cost number exists
 * yet. The code path below is implemented identically in spirit (same
 * CLI, same one-shot pattern) and ready to verify once quota is
 * available; per R9.7, no cost is invented for codex regardless (it has
 * no native cost figure at all, T1.11).
 *
 * opencode: same one-shot shape as the adapter fixtures
 * (`opencode run --format json --auto`, 1.18.29), plus `--agent plan`.
 * The plan agent denies `edit`, so this call rewrites the prompt and
 * does not patch the project. `--auto` answers any remaining permission
 * prompt so the call cannot sit until the timeout. `step_finish.cost`
 * is a real figure, including a genuine 0 on a subscription plan.
 *
 * Flags have to come before `--` and the prompt, and stdin has to be
 * closed. A live call on 2026-09-22 left stdin open (execFile's pipe)
 * and opencode sat after init until SIGTERM, empty stdout, 120s. The
 * same argv with `child.stdin.end()` returned a rewrite in about 9s
 * inside a real project.
 * dsh (BUG-0061): `dsh --profile headless -` answers one task on stdout
 * and puts diagnostics on stderr (dsh 0.2.1-rc.2 `--help`). Real run
 * 2026-10-21 in this repo: ~9s for one rewrite. The task goes over stdin
 * (`-`), so the prompt never becomes one giant argv entry. No costUsd —
 * dsh reports none (adapter capabilities cost:false), never guessed (R9.7).
 * DSH_PERMISSION_MODE=read-only mirrors the ACP preset: a pure rewrite
 * needs no tools at all, and if the model tries one anyway it must not
 * run silently.
 */

const INSTRUCTION =
  "Rewrite the user's raw instruction below into a well-structured coding-agent prompt with exactly these sections: Ziel, Scope, Constraints, Erfolgskriterium. Keep it concise. Output ONLY the rewritten prompt text, no preamble, no explanation, no markdown code fences.";

export interface EnhanceResult {
  enhanced: string;
  /** Real cost of this one call, when the adapter reports one (claude
   * and opencode do, opencode may report a genuine 0; codex doesn't — R9.7, never guessed). */
  costUsd?: number;
  latencyMs: number;
}

const TIMEOUT_MS = 30_000;
/** Headroom for a slow model. A correct invocation returns in well under
 * this; the old 30s budget was killing the hung argv shape above. */
const OPENCODE_TIMEOUT_MS = 120_000;
const MAX_BUFFER = 1024 * 1024;

/**
 * Pure parsing, split out from the subprocess call specifically so it's
 * unit-testable against real captured output (this repo's own
 * ground-truth-over-mocking convention, T1.2/T1.3) without spawning a
 * real, paid CLI call on every test run.
 */
export function parseClaudeEnhanceOutput(stdout: string): Omit<EnhanceResult, "latencyMs"> {
  const parsed = JSON.parse(stdout) as { result?: string; total_cost_usd?: number };
  return {
    enhanced: (parsed.result ?? "").trim(),
    ...(typeof parsed.total_cost_usd === "number" ? { costUsd: parsed.total_cost_usd } : {}),
  };
}

export function parseCodexEnhanceOutput(stdout: string): Omit<EnhanceResult, "latencyMs"> {
  let enhanced = "";
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line) as { type?: string; item?: { type?: string; text?: string } };
      if (obj.type === "item.completed" && obj.item?.type === "agent_message") {
        enhanced = obj.item.text ?? "";
      }
    } catch {
      // non-JSON line — ignore, matches the adapters' own fail-loud-but-
      // don't-crash handling of unexpected stream content.
    }
  }
  // No costUsd here — codex has no native cost figure (T1.11), never guessed.
  return { enhanced: enhanced.trim() };
}

export function parseOpencodeEnhanceOutput(stdout: string): Omit<EnhanceResult, "latencyMs"> {
  let enhanced = "";
  let costUsd: number | undefined;
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    let obj: { type?: string; part?: { text?: string; cost?: number } };
    try {
      obj = JSON.parse(line) as { type?: string; part?: { text?: string; cost?: number } };
    } catch {
      continue;
    }
    if (obj.type === "text" && typeof obj.part?.text === "string" && obj.part.text.trim()) {
      enhanced = enhanced ? `${enhanced}\n${obj.part.text}` : obj.part.text;
    }
    if (obj.type === "step_finish" && typeof obj.part?.cost === "number") {
      costUsd = (costUsd ?? 0) + obj.part.cost;
    }
  }
  return { enhanced: enhanced.trim(), ...(costUsd !== undefined ? { costUsd } : {}) };
}

async function enhanceViaClaude(rawText: string, cwd: string): Promise<EnhanceResult> {
  const start = Date.now();
  const { stdout } = await execFileAsync(
    "claude",
    [
      "-p",
      `${INSTRUCTION}\n\n---\n${rawText}`,
      "--output-format",
      "json",
      "--tools",
      "",
      "--dangerously-skip-permissions",
    ],
    { timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER, cwd },
  );
  return { ...parseClaudeEnhanceOutput(stdout), latencyMs: Date.now() - start };
}

async function enhanceViaCodex(rawText: string, cwd: string): Promise<EnhanceResult> {
  const start = Date.now();
  // 2026-10-24: execFile left stdin half-open for codex ("Reading additional
  // input from stdin..." — measured, hung until timeout). A fully ignored
  // stdin fd via spawn is the reliable shape; `< /dev/null` always worked.
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn("codex",
      ["exec", `${INSTRUCTION}\n\n${rawText}`, "--json", "--skip-git-repo-check", "--sandbox", "read-only"],
      { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let total = 0;
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), TIMEOUT_MS);
    child.stdout.on("data", (d: Buffer) => {
      total += d.length;
      if (total > MAX_BUFFER) child.kill("SIGTERM");
      else chunks.push(d);
    });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(chunks).toString());
      else reject(Object.assign(new Error(`codex enhance failed: ${stderr.trim().slice(0, 300)}`), { stderr }));
    });
  });
  return { ...parseCodexEnhanceOutput(stdout), latencyMs: Date.now() - start };
}

/** Argv for the one-shot. Exported so a test can lock the flag order. */
export function opencodeEnhanceArgs(rawText: string): string[] {
  return ["run", "--format", "json", "--auto", "--agent", "plan", "--", `${INSTRUCTION}\n\n---\n${rawText}`];
}

function enhanceFailure(adapter: string, err: unknown): Error {
  const failure = err as { killed?: boolean; signal?: string; stderr?: unknown; message?: string };
  const stderr = typeof failure.stderr === "string" ? failure.stderr.trim().slice(0, 300) : "";
  if (failure.killed || failure.signal === "SIGTERM") {
    return new Error(
      stderr
        ? `${adapter} hat nicht rechtzeitig geantwortet. ${stderr}`
        : `${adapter} hat nicht rechtzeitig geantwortet.`,
    );
  }
  if (stderr) return new Error(stderr);
  if (err instanceof Error && err.message && !err.message.startsWith("Command failed:")) return err;
  return new Error(`${adapter}: Prompt verbessern fehlgeschlagen.`);
}

async function enhanceViaOpencode(rawText: string, cwd: string): Promise<EnhanceResult> {
  const start = Date.now();
  let stdout: string;
  try {
    stdout = await new Promise<string>((resolve, reject) => {
      const child = execFile(
        "opencode",
        opencodeEnhanceArgs(rawText),
        { timeout: OPENCODE_TIMEOUT_MS, maxBuffer: MAX_BUFFER, cwd },
        (err, out, stderr) => {
          if (err) {
            const failure = err as { stderr?: string };
            if (typeof stderr === "string" && stderr.trim()) failure.stderr = stderr;
            reject(err);
            return;
          }
          resolve(out);
        },
      );
      // execFile leaves stdin open. opencode then waits on that pipe after
      // init and never creates a session (empty stdout until the timeout).
      // Closing it is the difference between a ~9s rewrite and a 120s kill.
      // `stdio: "ignore"` does not stick — execFile still hands us a stdin stream.
      child.stdin?.end();
    });
  } catch (err) {
    throw enhanceFailure("OpenCode", err);
  }
  const parsed = parseOpencodeEnhanceOutput(stdout);
  if (!parsed.enhanced) throw new Error("OpenCode hat keinen umgeschriebenen Prompt geliefert.");
  return { ...parsed, latencyMs: Date.now() - start };
}

async function enhanceViaDsh(rawText: string, cwd: string): Promise<EnhanceResult> {
  const start = Date.now();
  let stdout: string;
  try {
    stdout = await new Promise<string>((resolve, reject) => {
      const child = execFile(
        "dsh",
        ["--profile", "headless", "-"],
        // Headless answers in ~9s measured; 120s is the same headroom the
        // opencode one-shot gets for a slow model.
        { timeout: OPENCODE_TIMEOUT_MS, maxBuffer: MAX_BUFFER, cwd, env: { ...process.env, DSH_PERMISSION_MODE: "read-only" } },
        (err, out, stderr) => {
          if (err) {
            const failure = err as { stderr?: string };
            if (typeof stderr === "string" && stderr.trim()) failure.stderr = stderr;
            reject(err);
            return;
          }
          resolve(out);
        },
      );
      // Same lesson as opencode: a stdin pipe held open keeps the agent
      // waiting. Here stdin is the task channel, so `-` plus one write.
      child.stdin?.end(`${INSTRUCTION}\n\n---\n${rawText}`);
    });
  } catch (err) {
    throw enhanceFailure("DeepSeek Harness", err);
  }
  const parsed = parseDshEnhanceOutput(stdout);
  if (!parsed.enhanced) throw new Error("DeepSeek Harness hat keinen umgeschriebenen Prompt geliefert.");
  return { ...parsed, latencyMs: Date.now() - start };
}

/** dsh headless prints the final answer and nothing else to stdout —
 * trimming is all the parsing there is (kept as a function so the real
 * captured shape is locked by a test, same as the other parsers). */
export function parseDshEnhanceOutput(stdout: string): Omit<EnhanceResult, "latencyMs"> {
  return { enhanced: stdout.trim() };
}

/** Which one-shot enhancer a registration can use, derived from the
 * registry (module + config), not from a hardcoded adapter id — ids are
 * free-form in hub.config.json ("deepseek", "securesight-factory", …),
 * BUG-0061. */
export type EnhanceFlavor = "claude" | "codex" | "opencode" | "dsh";

export function enhanceFlavorFor(id: string, module?: string, config?: Record<string, unknown>): EnhanceFlavor | null {
  if (id === "claude" || id === "codex" || id === "opencode") return id;
  // Only an ACP registration of dsh gets the dsh enhancer — the preset
  // names the binary, a custom `command` starting with dsh does too.
  if (module?.includes("adapter-acp")) {
    if (config?.preset === "dsh") return "dsh";
    const command = config?.command;
    if (Array.isArray(command) && command[0] === "dsh") return "dsh";
  }
  return null;
}

/**
 * `project` sets the CLI's cwd — found necessary via a real end-to-end
 * test: without it, the call ran in the *hub server's own* working
 * directory (wherever `main.ts` happened to be started from), so the
 * "enhanced" prompt reflected the hub's own repo instead of whatever
 * project the user actually selected. The caller is responsible for the
 * same containment check used for session creation (isProjectPathAllowed,
 * routes.ts) — this function trusts the path it's given.
 */
export async function enhancePrompt(
  adapterId: string,
  rawText: string,
  project: string,
  registration?: { module?: string; config?: Record<string, unknown> },
): Promise<EnhanceResult> {
  const flavor = enhanceFlavorFor(adapterId, registration?.module, registration?.config);
  if (flavor === "claude") return enhanceViaClaude(rawText, project);
  if (flavor === "codex") return enhanceViaCodex(rawText, project);
  if (flavor === "opencode") return enhanceViaOpencode(rawText, project);
  if (flavor === "dsh") return enhanceViaDsh(rawText, project);
  // 2026-10-24: adapters without a native enhancer (aider, copilot, custom
  // registrations) fell over with a 502 and a dead "Verbessern" button.
  // Fallback: enhance through opencode — works for every adapter selection.
  return enhanceViaOpencode(rawText, project);
}
