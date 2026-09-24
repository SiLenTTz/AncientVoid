#!/usr/bin/env node
// T10.1/T10.2 / AC-P10-1 (K6): speech end → text, through the real path:
// phone-like webm/opus → hub (ffmpeg → 16 kHz WAV) → whisper-server.
//
//   node scripts/messlauf-stt.mjs <dir with *.webm> <sentences.tsv> [stt-url] [rounds]
/* global fetch */
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [dir, refsPath, sttUrl = "http://100.65.133.28:8094/inference", roundsArg = "3"] = process.argv.slice(2);
const repo = resolve(import.meta.dirname, "..");
const root = mkdtempSync(join(tmpdir(), "uacc-stt-"));
const port = 7398;
const config = join(root, "hub.config.json");
// The hub's own projects feed the vocabulary (T10.2) — like on the live hub.
const projects = join(root, "projects");
for (const name of ["mobile-hub", "custom-rag"]) {
  const p = join(projects, name);
  execFileSync("mkdir", ["-p", p]);
  execFileSync("git", ["init", "-q"], { cwd: p });
}
writeFileSync(config, JSON.stringify({ dataDir: join(root, "data"), workerRunner: "process", projectRoots: [projects], server: { host: "127.0.0.1", port }, adapters: [], stt: { url: sttUrl } }));
const token = execFileSync(process.execPath, [join(repo, "apps/hubctl/src/cli.ts"), "token", "issue", "stt", "--db", join(root, "data", "hub.db")], { encoding: "utf8" }).split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("token for"));
const hub = spawn(process.execPath, [join(repo, "apps/hub/src/main.ts")], { cwd: repo, env: { ...process.env, UACC_CONFIG: config }, stdio: "ignore" });
for (let i = 0; i < 80; i++) {
  try {
    if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break;
  } catch {
    // hub still starting
  }
  await new Promise((r) => setTimeout(r, 250));
}

const refs = Object.fromEntries(readFileSync(refsPath, "utf8").split("\n").slice(1).filter(Boolean).map((l) => l.split("\t")).map(([id, text, terms]) => [id, { text, terms: (terms ?? "").split("|").filter(Boolean) }]));
const NUMBERS = { eins: "1", zwei: "2", drei: "3", vier: "4", fünf: "5", sechs: "6", sieben: "7", acht: "8", neun: "9", zehn: "10", zwanzig: "20", dreißig: "30", vierzig: "40", fünfzig: "50", hundert: "100" };
const squash = (s) => {
  let t = s.toLowerCase();
  for (const [w, d] of Object.entries(NUMBERS)) t = t.replace(new RegExp(`(?<![\\p{L}])${w}(?![\\p{L}])`, "gu"), d);
  return t.replace(/[^\p{L}\p{N}]/gu, "");
};
const files = readdirSync(dir).filter((f) => f.endsWith(".webm")).sort();
const rows = [];
const misses = [];
for (let round = 0; round < Number(roundsArg); round++) {
  for (const f of files) {
    const audio = readFileSync(join(dir, f));
    const t0 = performance.now();
    const res = await fetch(`http://127.0.0.1:${port}/api/stt`, { method: "POST", headers: { "content-type": "audio/webm", authorization: `Bearer ${token}` }, body: audio });
    const body = await res.json();
    const ms = performance.now() - t0;
    const id = f.replace(".webm", "");
    const terms = refs[id]?.terms ?? [];
    if (round === 0) for (const t of terms) if (!squash(body.text ?? "").includes(squash(t))) misses.push(`${id}: „${t}“ ← ${body.text}`);
    rows.push({ id, round, ms, server: body.latencyMs, convert: body.convertMs, audioMs: body.audioMs, ok: res.ok, termsOk: terms.filter((t) => squash(body.text ?? "").includes(squash(t))).length, terms: terms.length });
  }
}
hub.kill("SIGINT");
const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
const conv = rows.map((r) => r.convert).sort((a, b) => a - b);
const audio = rows.map((r) => r.audioMs).sort((a, b) => a - b);
const summary = {
  date: new Date().toISOString(),
  sttUrl,
  clips: files.length,
  rounds: Number(roundsArg),
  failures: rows.filter((r) => !r.ok).length,
  k6: { p50: Math.round(q(ms, 0.5)), p90: Math.round(q(ms, 0.9)), max: Math.round(ms.at(-1)), min: Math.round(ms[0]) },
  convertMs: { p50: q(conv, 0.5), p90: q(conv, 0.9) },
  audioSeconds: { p50: q(audio, 0.5) / 1000, max: audio.at(-1) / 1000 },
  terms: `${rows.reduce((s, r) => s + r.termsOk, 0)}/${rows.reduce((s, r) => s + r.terms, 0)}`,
};
console.log(JSON.stringify(summary, null, 2));
if (process.env.SHOW_MISSES) console.log(misses.join("\n"));
