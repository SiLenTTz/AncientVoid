#!/usr/bin/env node
/**
 * Messlauf EPIC-P7 against real provider CLIs on this machine.
 *
 *   node scripts/messlauf-p7.mjs claude-gate
 *   node scripts/messlauf-p7.mjs acp-gate <preset> [adapter-config-json]
 *   LLAMA_KEY=… node scripts/messlauf-p7.mjs acp-gate opencode
 *   LLAMA_KEY=… node scripts/messlauf-p7.mjs local-model [opencode|dsh]
 *
 * Boots its own hub (own data dir and port, real adapters, no skip flags),
 * drives it over the HTTP API the way the phone does and checks the real
 * side effects in the session worktree. Prints numbers and a verdict; the
 * record lives under docs/messlauf/.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..");
const step = process.argv[2];
const PORT = 7399;
const base = `http://127.0.0.1:${PORT}`;

function http(method, path, token, body) {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((ok, fail) => {
    const req = request(
      `${base}${path}`,
      { method, agent: false, headers: { authorization: `Bearer ${token}`, ...(payload ? { "content-type": "application/json" } : {}) } },
      (res) => {
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () => ok({ status: res.statusCode, body: text ? JSON.parse(text) : null }));
      },
    );
    req.on("error", fail);
    if (payload) req.write(payload);
    req.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, label, timeoutMs = Number(process.env.MESSLAUF_TIMEOUT_MS ?? 240_000)) {
  const t0 = Date.now();
  for (;;) {
    const v = await check();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout: ${label}`);
    await sleep(500);
  }
}

async function bootHub(adapters) {
  const root = mkdtempSync(join(tmpdir(), "uacc-p7-"));
  const projects = join(root, "projects");
  const project = join(projects, "gate-probe");
  mkdirSync(project, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: project });
  writeFileSync(join(project, "README.md"), "# gate probe\n");
  execFileSync("git", ["add", "-A"], { cwd: project });
  execFileSync("git", ["-c", "user.email=p7@uacc", "-c", "user.name=p7", "commit", "-qm", "init"], { cwd: project });
  const config = join(root, "hub.config.json");
  writeFileSync(config, JSON.stringify({ dataDir: join(root, "data"), workerRunner: "tmux", projectRoots: [projects], server: { host: "127.0.0.1", port: PORT }, adapters }, null, 2));
  const token = execFileSync(process.execPath, [join(repo, "apps/hubctl/src/cli.ts"), "token", "issue", "messlauf", "--db", join(root, "data", "hub.db")], { encoding: "utf8" })
    .split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("token for"));
  const log = join(root, "hub.log");
  const child = spawn(process.execPath, [join(repo, "apps/hub/src/main.ts")], { cwd: repo, env: { ...process.env, UACC_CONFIG: config, TMUX_TMPDIR: root }, stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.on("data", (c) => writeFileSync(log, c, { flag: "a" }));
  await until(async () => (await http("GET", "/api/health", token).catch(() => ({ status: 0 }))).status === 200, "hub up", 20_000);
  // BUG-0034: full teardown — the hub keeps tmux workers alive on purpose
  // (K7 restart), but this throwaway hub will never come back: wait for the
  // process, then kill ITS tmux server (own TMUX_TMPDIR) and remove the root.
  const stop = async () => {
    if (child.exitCode !== null) return;
    await new Promise((done) => {
      const hard = setTimeout(() => {
        child.kill("SIGKILL");
        done();
      }, 10_000);
      child.on("exit", () => {
        clearTimeout(hard);
        done();
      });
      child.kill("SIGINT");
    });
    try {
      execFileSync("tmux", ["kill-server"], { env: { ...process.env, TMUX_TMPDIR: root, TMUX: "" }, stdio: "ignore" });
    } catch {
      // no server / tmux gone — nothing to kill
    }
    rmSync(root, { recursive: true, force: true });
  };
  return { root, project, token, stop };
}

/** `further`: decision for any later request in the same turn (null: leave it).
 * `optional`: a turn may also end without asking (a sandboxed read). */
async function runClaude(hub, prompt, decide, further = null, adapter = "claude", optional = false) {
  const created = await http("POST", "/api/sessions", hub.token, { adapter, project: hub.project, prompt });
  if (created.status !== 201) throw new Error(`create: ${created.status} ${JSON.stringify(created.body)}`);
  const id = created.body.id;
  const t0 = Date.now();
  const pending = await until(async () => {
    const list = (await http("GET", "/api/approvals?status=pending", hub.token)).body;
    const found = list.find((a) => a.sessionId === id);
    if (found || !optional) return found;
    const ended = (await http("GET", `/api/sessions/${id}/events?afterSeq=0&limit=2000`, hub.token)).body.some((e) => e.payload?.kind === "session.turn_end");
    return ended ? { none: true } : undefined;
  }, "approval request").catch(async (err) => {
    // What the session did instead — the reason is in the tail.
    const tail = (await http("GET", `/api/sessions/${id}/events?afterSeq=0&limit=200`, hub.token)).body;
    console.error(tail.map((e) => `${e.type}: ${e.summary ?? ""} ${JSON.stringify(e.payload).slice(0, 200)}`).join("\n"));
    throw err;
  });
  const askedAfterMs = pending.none ? null : Date.now() - t0;
  const status = (await http("GET", `/api/sessions/${id}`, hub.token)).body.status;
  if (!pending.none) {
    const decision = await decide(pending);
    const d = await http("POST", `/api/approvals/${pending.id}/decide`, hub.token, decision);
    if (d.status !== 200) throw new Error(`decide: ${d.status} ${JSON.stringify(d.body)}`);
  }
  const followUps = [];
  await until(async () => {
    if (further) {
      const next = (await http("GET", "/api/approvals?status=pending", hub.token)).body.find((a) => a.sessionId === id);
      if (next) {
        followUps.push(next.tool?.name ?? next.action);
        await http("POST", `/api/approvals/${next.id}/decide`, hub.token, further);
      }
    }
    return (await http("GET", `/api/sessions/${id}`, hub.token)).body.status === "idle";
  }, "turn end");
  const events = (await http("GET", `/api/sessions/${id}/events?afterSeq=0&limit=2000`, hub.token)).body;
  const workdir = (await http("GET", `/api/sessions/${id}`, hub.token)).body.worktree?.path ?? hub.project;
  return { id, pending: pending.none ? {} : pending, asked: !pending.none, askedAfterMs, statusWhileAsking: status, events, workdir, followUps };
}

if (step === "claude-gate") {
  const hub = await bootHub([{ id: "claude", module: "@uacc/adapter-claude", config: { extraArgs: ["--model", "sonnet"] } }]);
  const results = [];
  try {
    // 1. allow: the tool runs with the approved argument
    const allow = await runClaude(hub, "Führe mit dem Bash-Tool genau diesen Befehl aus: echo live-ok > erlaubt.txt — sonst nichts.", () => ({ decision: "approve" }));
    const allowed = existsSync(join(allow.workdir, "erlaubt.txt")) ? readFileSync(join(allow.workdir, "erlaubt.txt"), "utf8").trim() : null;
    results.push({ case: "allow", tool: allow.pending.tool?.name, input: allow.pending.tool?.input, askedAfterMs: allow.askedAfterMs, statusWhileAsking: allow.statusWhileAsking, fileContent: allowed, pass: allowed === "live-ok" });
    // 2. deny: the tool does not run
    const deny = await runClaude(hub, "Führe mit dem Bash-Tool genau diesen Befehl aus: touch verboten.txt — sonst nichts. Wenn es abgelehnt wird, versuche es nicht erneut.", () => ({ decision: "reject", reason: "Messlauf: ablehnen" }));
    const denied = existsSync(join(deny.workdir, "verboten.txt"));
    const toolError = deny.events.some((e) => e.type === "tool_result" && e.payload.isError);
    results.push({ case: "deny", tool: deny.pending.tool?.name, fileExists: denied, toolResultIsError: toolError, pass: !denied && toolError });
    // 3. question: AskUserQuestion answered on the "phone"
    const ask = await runClaude(
      hub,
      "Stelle mir mit dem AskUserQuestion-Tool genau eine Frage: Welche Farbe soll das Logo haben? Optionen Rot und Grün. Schreibe danach die gewählte Farbe mit Bash in farbe.txt (echo <Farbe> > farbe.txt).",
      async (p) => ({ decision: "approve", answers: { [p.tool.questions[0].question]: "Grün" } }),
      { decision: "approve" }, // the Bash call that writes the answer asks too
    );
    const color = existsSync(join(ask.workdir, "farbe.txt")) ? readFileSync(join(ask.workdir, "farbe.txt"), "utf8").trim() : null;
    results.push({ case: "question", question: ask.pending.tool?.questions?.[0]?.question, followUps: ask.followUps, fileContent: color, pass: color === "Grün" });
  } finally {
    await hub.stop();
  }
  const claudeVersion = execFileSync("claude", ["--version"], { encoding: "utf8" }).trim();
  console.log(JSON.stringify({ step, claudeVersion, date: new Date().toISOString(), results }, null, 2));
  console.log(results.every((r) => r.pass) ? "PASS" : "FAIL");
  process.exit(results.every((r) => r.pass) ? 0 : 1);
} else if (step === "acp-gate" || step === "codex-gate") {
  const preset = step === "codex-gate" ? "codex app-server" : process.argv[3];
  const extra = process.argv[step === "codex-gate" ? 3 : 4] ? JSON.parse(process.argv[step === "codex-gate" ? 3 : 4]) : {};
  const localModel = step === "acp-gate" && preset === "opencode" && Boolean(process.env.LLAMA_KEY);
  const acpConfig = { preset, ...extra };
  if (localModel) {
    const base = process.env.LLAMA_URL ?? "http://100.65.133.28:8081/v1";
    acpConfig.label = "opencode+lokal";
    acpConfig.env = {
      ...(acpConfig.env ?? {}),
      OPENCODE_CONFIG_CONTENT: JSON.stringify({
        permission: { edit: "ask", bash: "ask", webfetch: "ask" },
        provider: { evox2: { npm: "@ai-sdk/openai-compatible", name: "evox2 llama.cpp", options: { baseURL: base, apiKey: process.env.LLAMA_KEY }, models: { "qwen3-coder": { name: "Qwen3-Coder-30B-A3B (lokal)", tool_call: true } } } },
        model: "evox2/qwen3-coder",
      }),
    };
  }
  const hub = await bootHub([
    step === "codex-gate"
      ? { id: "agent", module: "@uacc/adapter-codex", config: { mode: "app-server", ...extra } }
      : { id: "agent", module: "@uacc/adapter-acp", config: acpConfig },
  ]);
  const results = [];
  const t0 = Date.now();
  try {
    const allow = await runClaude(hub, "Run exactly this shell command with your shell/terminal tool: echo live-ok > erlaubt.txt — nothing else.", () => ({ decision: "approve" }), { decision: "approve" }, "agent");
    const allowed = existsSync(join(allow.workdir, "erlaubt.txt")) ? readFileSync(join(allow.workdir, "erlaubt.txt"), "utf8").trim() : null;
    results.push({ case: "allow", tool: allow.pending.tool?.name, input: allow.pending.tool?.input?.slice(0, 200), askedAfterMs: allow.askedAfterMs, statusWhileAsking: allow.statusWhileAsking, followUps: allow.followUps, fileContent: allowed, pass: allowed === "live-ok" });
    const deny = await runClaude(hub, "Run exactly this shell command with your shell/terminal tool: touch verboten.txt — nothing else. If it is rejected, do not retry and do not work around it.", () => ({ decision: "reject", reason: "Messlauf: ablehnen" }), { decision: "reject", reason: "Messlauf: ablehnen" }, "agent");
    const denied = existsSync(join(deny.workdir, "verboten.txt"));
    results.push({ case: "deny", tool: deny.pending.tool?.name, fileExists: denied, followUps: deny.followUps, pass: !denied });
  } finally {
    await hub.stop();
  }
  console.log(JSON.stringify({ step, preset, ...(localModel ? { model: "Qwen3-Coder-30B-A3B-Instruct UD-Q4_K_XL · llama.cpp · evox2" } : {}), date: new Date().toISOString(), durationMs: Date.now() - t0, results }, null, 2));
  console.log(results.every((r) => r.pass) ? "PASS" : "FAIL");
  process.exit(results.every((r) => r.pass) ? 0 : 1);
} else if (step === "local-model") {
  // AC-P7-1: a local model (llama.cpp on evox2) through a real harness —
  // tool success and tool failure. Harness: opencode over ACP, provider
  // pointed at the tailnet llama-server; the key comes from LLAMA_KEY.
  const key = process.env.LLAMA_KEY;
  const base = process.env.LLAMA_URL ?? "http://100.65.133.28:8081/v1";
  if (!key) throw new Error("LLAMA_KEY missing");
  const harness = process.argv[3] ?? "opencode";
  let adapterConfig;
  if (harness === "dsh") {
    // DeepSeek harness: its pi-ai adapter takes a hand-declared
    // OpenAI-compatible route from settings.yaml; the key stays in the env.
    const home = mkdtempSync(join(tmpdir(), "uacc-dsh-"));
    writeFileSync(
      join(home, "settings.yaml"),
      [
        "llm-pi-ai:",
        "  providers:",
        "    evox2:",
        "      displayName: evox2 llama.cpp",
        "      apiKeyEnv: LLAMA_KEY",
        "      api: openai-completions",
        `      baseURL: ${base}`,
        "      models:",
        "        - id: qwen3-coder",
        "          name: Qwen3 Coder 30B A3B",
        "          contextWindow: 65536",
        "agent-default-model:",
        "  provider: evox2",
        "  model: qwen3-coder",
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    adapterConfig = { preset: "dsh", label: "dsh+lokal", model: "evox2/qwen3-coder", env: { DSH_HOME: home, LLAMA_KEY: key } };
  } else {
    const opencodeConfig = {
      permission: { edit: "ask", bash: "ask", webfetch: "ask" },
      provider: { evox2: { npm: "@ai-sdk/openai-compatible", name: "evox2 llama.cpp", options: { baseURL: base, apiKey: key }, models: { "qwen3-coder": { name: "Qwen3-Coder-30B-A3B (lokal)", tool_call: true } } } },
      model: "evox2/qwen3-coder",
    };
    adapterConfig = { preset: "opencode", label: "opencode+lokal", env: { OPENCODE_CONFIG_CONTENT: JSON.stringify(opencodeConfig) } };
  }
  const hub = await bootHub([{ id: "agent", module: "@uacc/adapter-acp", config: adapterConfig }]);
  const results = [];
  const t0 = Date.now();
  try {
    const ok = await runClaude(hub, "Run exactly this shell command with your shell tool: echo lokal-ok > lokal.txt — then say done.", () => ({ decision: "approve" }), { decision: "approve" }, "agent");
    const content = existsSync(join(ok.workdir, "lokal.txt")) ? readFileSync(join(ok.workdir, "lokal.txt"), "utf8").trim() : null;
    results.push({ case: "tool success", tool: ok.pending.tool?.name, askedAfterMs: ok.askedAfterMs, fileContent: content, pass: content === "lokal-ok" });
    // A read may run sandboxed without asking (dsh read-only) — both are fine.
    const fail = await runClaude(hub, "Run exactly this shell command with your shell tool: cat /gibt/es/nicht.txt — then tell me what happened.", () => ({ decision: "approve" }), { decision: "approve" }, "agent", true);
    const failed = fail.events.filter((e) => e.type === "tool_result").map((e) => ({ isError: e.payload.isError, content: String(e.payload.content ?? "").slice(0, 120) }));
    const answer = fail.events.filter((e) => e.type === "assistant").map((e) => String(e.payload.text ?? "")).join(" ").slice(0, 300);
    results.push({ case: "tool failure", asked: fail.asked, results: failed, answer, pass: failed.some((r) => r.isError || /No such file|nicht|not found/i.test(r.content)) && /not exist|no such|nicht|not found/i.test(answer) });
  } finally {
    await hub.stop();
  }
  console.log(JSON.stringify({ step, harness, model: "Qwen3-Coder-30B-A3B-Instruct UD-Q4_K_XL · llama.cpp b11149 Vulkan · evox2", date: new Date().toISOString(), durationMs: Date.now() - t0, results }, null, 2));
  console.log(results.every((r) => r.pass) ? "PASS" : "FAIL");
  process.exit(results.every((r) => r.pass) ? 0 : 1);
} else {
  console.error("usage: messlauf-p7.mjs claude-gate | acp-gate <preset> [config-json] | codex-gate [config-json] | local-model [opencode|dsh]");
  process.exit(2);
}
