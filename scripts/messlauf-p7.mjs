#!/usr/bin/env node
/**
 * Messlauf EPIC-P7 against real provider CLIs on this machine.
 *
 *   node scripts/messlauf-p7.mjs claude-gate
 *
 * Boots its own hub (own data dir and port, real adapters, no skip flags),
 * drives it over the HTTP API the way the phone does and checks the real
 * side effects in the session worktree. Prints numbers and a verdict; the
 * record lives under docs/messlauf/.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
async function until(check, label, timeoutMs = 240_000) {
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
  return { root, project, token, stop: () => child.kill("SIGINT") };
}

/** `further`: decision for any later request in the same turn (null: leave it). */
async function runClaude(hub, prompt, decide, further = null) {
  const created = await http("POST", "/api/sessions", hub.token, { adapter: "claude", project: hub.project, prompt });
  if (created.status !== 201) throw new Error(`create: ${created.status} ${JSON.stringify(created.body)}`);
  const id = created.body.id;
  const t0 = Date.now();
  const pending = await until(async () => {
    const list = (await http("GET", "/api/approvals?status=pending", hub.token)).body;
    return list.find((a) => a.sessionId === id);
  }, "approval request");
  const askedAfterMs = Date.now() - t0;
  const status = (await http("GET", `/api/sessions/${id}`, hub.token)).body.status;
  const decision = await decide(pending);
  const d = await http("POST", `/api/approvals/${pending.id}/decide`, hub.token, decision);
  if (d.status !== 200) throw new Error(`decide: ${d.status} ${JSON.stringify(d.body)}`);
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
  return { id, pending, askedAfterMs, statusWhileAsking: status, events, workdir, followUps };
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
    hub.stop();
  }
  const claudeVersion = execFileSync("claude", ["--version"], { encoding: "utf8" }).trim();
  console.log(JSON.stringify({ step, claudeVersion, date: new Date().toISOString(), results }, null, 2));
  console.log(results.every((r) => r.pass) ? "PASS" : "FAIL");
  process.exit(results.every((r) => r.pass) ? 0 : 1);
} else {
  console.error("usage: messlauf-p7.mjs claude-gate");
  process.exit(2);
}
