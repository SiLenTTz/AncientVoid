#!/usr/bin/env node
/**
 * Messlauf EPIC-P5 against a real hub process (the E2E gate's TestHub:
 * apps/hub/src/main.ts, own data dir, fake provider CLIs).
 *
 *   node scripts/messlauf-p5.mjs discovery [--runs 10]   # AC-P5-1 (K9)
 *   node scripts/messlauf-p5.mjs recovery  [--runs 10]   # AC-P5-3 (K7), dummy
 *   node scripts/messlauf-p5.mjs recovery-provider [--runs 5]  # AC-P5-3, opencode under tmux
 *
 * Prints raw numbers and a verdict. The record of a run lives under
 * docs/messlauf/ (messlauf skill), this script alone is not the record.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TestHub } from "../e2e/support/hub.ts";

const [mode, ...rest] = process.argv.slice(2);
const flag = (name, def) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? Number(rest[i + 1]) : def;
};
const RUNS = flag("runs", 10);

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
  return { n: sorted.length, min: sorted[0], median: q(0.5), p95: q(0.95), max: sorted.at(-1) };
}
const fmt = (s) => `n=${s.n} min=${s.min} median=${s.median} p95=${s.p95} max=${s.max} ms`;

async function discovery() {
  const hub = await TestHub.start();
  try {
    // 10 hub sessions: five per project (alpha, beta).
    for (const project of [hub.alpha, hub.beta]) {
      for (let i = 0; i < 5; i++) await hub.createSession({ adapter: "dummy", project });
    }
    // 10 external Claude transcripts: five projects × two, one of them
    // copied into a second project dir (same native id → must dedupe), plus
    // one file in an unknown format (K9: must show as unsupported).
    const projects = join(hub.root, "claude", "projects");
    for (let p = 1; p <= 5; p++) {
      const dir = join(projects, `-home-user-extern-${p}`);
      mkdirSync(dir, { recursive: true });
      for (let s = 1; s <= 2; s++) writeFileSync(join(dir, `ext-${p}-${s}.jsonl`), `{"type":"user","sessionId":"ext-${p}-${s}"}\n`);
    }
    writeFileSync(join(projects, "-home-user-extern-5", "ext-1-1.jsonl"), "{}\n");
    writeFileSync(join(projects, "-home-user-extern-1", "notes.txt"), "not a transcript\n");

    const check = (items) => {
      const keys = items.map((i) => `${i.hostId}|${i.adapter}|${i.nativeSessionId ?? i.hubSessionId}`);
      return {
        total: items.length,
        hub: items.filter((i) => i.hubSessionId !== null).length,
        external: items.filter((i) => i.hubSessionId === null && i.status !== "unsupported-format").length,
        unsupported: items.filter((i) => i.status === "unsupported-format").length,
        duplicates: keys.length - new Set(keys).size,
      };
    };
    const warm = [];
    let last;
    for (let r = 0; r < RUNS; r++) {
      const t0 = performance.now();
      const res = await hub.api("/api/discovery?limit=50");
      warm.push(Math.round(performance.now() - t0));
      last = check(res.body.items);
    }
    const cold = [];
    for (let r = 0; r < Math.min(RUNS, 5); r++) {
      const t0 = performance.now();
      await hub.restart("SIGKILL");
      const res = await hub.api("/api/discovery?limit=50");
      cold.push(Math.round(performance.now() - t0));
      last = check(res.body.items);
    }
    console.log("AC-P5-1 discovery");
    console.log("  result:", JSON.stringify(last));
    console.log("  warm GET /api/discovery:", fmt(stats(warm)));
    console.log("  cold (kill -9 → hub ready → discovery answered):", fmt(stats(cold)));
    const ok = last.hub === 10 && last.external === 10 && last.unsupported === 1 && last.duplicates === 0 && stats(cold).max < 10_000;
    console.log(`  verdict: ${ok ? "PASS" : "FAIL"} (20 unique, 1 unsupported, 0 duplicates, cold < 10 s)`);
    return ok;
  } finally {
    await hub.stop();
  }
}

async function recovery() {
  const hub = await TestHub.start({ dummyAutoStop: 0 });
  try {
    const running = [];
    for (let i = 0; i < 20; i++) running.push(await hub.createSession({ adapter: "dummy", project: i % 2 ? hub.alpha : hub.beta }));
    const stopped = [];
    for (let i = 0; i < 30; i++) stopped.push(await hub.createSession({ adapter: "dummy" }));
    await new Promise((r) => setTimeout(r, 3000));
    for (const id of stopped) await hub.api(`/api/sessions/${id}/stop`, { body: {} });
    let stoppedEvents = 0;
    for (const id of stopped) stoppedEvents += (await hub.events(id)).length;

    const recoveryMs = [];
    const readyMs = [];
    let mismatches = 0;
    let uncontrolled = 0;
    let steerFailures = 0;
    for (let r = 0; r < RUNS; r++) {
      await new Promise((res) => setTimeout(res, 500));
      const confirmed = new Map();
      for (const id of running) confirmed.set(id, (await hub.events(id)).map((e) => `${e.seq}|${e.type}|${e.summary}`));
      readyMs.push(await hub.restart("SIGKILL"));
      const metrics = (await hub.api("/api/metrics")).body;
      recoveryMs.push(Math.round(metrics.gauges.recovery_ms));
      for (const id of running) {
        const after = (await hub.events(id)).map((e) => `${e.seq}|${e.type}|${e.summary}`);
        const before = confirmed.get(id);
        if (after.slice(0, before.length).join("\n") !== before.join("\n")) mismatches++;
        const recovered = (await hub.events(id)).filter((e) => e.payload.kind === "session.recovered").at(-1);
        if (recovered?.payload.controllable !== true) uncontrolled++;
      }
      const probe = running[r % running.length];
      const ack = await hub.api(`/api/sessions/${probe}/steer`, { body: { kind: "prompt", text: `nach Kill ${r}` } });
      if (ack.status !== 200) steerFailures++;
    }
    const rec = stats(recoveryMs);
    console.log("AC-P5-3 recovery (K7)");
    console.log(`  setup: 20 running dummy sessions at 20 ev/s, 30 stopped sessions with ${stoppedEvents} events in total`);
    console.log("  hub recovery_ms (recoverAll, hub's own gauge):", fmt(rec));
    console.log("  kill -9 → /api/ready (incl. Node start):", fmt(stats(readyMs)));
    console.log(`  confirmed-prefix mismatches: ${mismatches} · not controllable: ${uncontrolled} · failed steers: ${steerFailures}`);
    const ok = rec.max < 3000 && mismatches === 0 && uncontrolled === 0 && steerFailures === 0;
    console.log(`  verdict: ${ok ? "PASS" : "FAIL"} (recovery < 3 s, exact confirmed sequence, controllable again)`);
    return ok;
  } finally {
    await hub.stop();
  }
}

async function recoveryProvider() {
  // Real adapter-opencode + tmux runner, fake CLI: each turn outlives the kill.
  const hub = await TestHub.start({ runner: "tmux" });
  try {
    const recoveryMs = [];
    let lostAnswers = 0;
    let duplicateOutput = 0;
    let uncontrolled = 0;
    let foreignResume = 0;
    const SESSIONS = 5;
    for (let r = 0; r < RUNS; r++) {
      const ids = [];
      for (let i = 0; i < SESSIONS; i++) ids.push(await hub.createSession({ adapter: "opencode", prompt: `Lauf ${r}.${i} WARTE2` }));
      await hub.until(async () => {
        for (const id of ids) if (!(await hub.events(id)).some((e) => e.type === "tool_use")) return false;
        return true;
      }, "all turns running");
      await hub.restart("SIGKILL");
      recoveryMs.push(Math.round((await hub.api("/api/metrics")).body.gauges.recovery_ms));
      for (const id of ids) {
        const done = async () => (await hub.events(id)).some((e) => e.type === "assistant");
        await hub.until(done, `answer ${id}`, 10_000).catch(() => lostAnswers++);
        const events = await hub.events(id);
        if (events.filter((e) => e.type === "tool_use").length !== 1) duplicateOutput++;
        if (events.find((e) => e.payload.kind === "session.recovered")?.payload.controllable !== true) uncontrolled++;
        const native = (await hub.api(`/api/sessions/${id}`)).body.nativeSessionId;
        await hub.api(`/api/sessions/${id}/steer`, { body: { kind: "prompt", text: "danach" } });
        await hub.until(async () => (await hub.events(id)).filter((e) => e.type === "assistant").length === 2, `second answer ${id}`, 10_000).catch(() => lostAnswers++);
        const second = (await hub.events(id)).filter((e) => e.type === "assistant").at(-1);
        if (!String(second?.payload.text).includes(`Session ${native} (fortgesetzt)`)) foreignResume++;
      }
    }
    const rec = stats(recoveryMs);
    console.log("AC-P5-3 recovery with a provider adapter (opencode, tmux, turn running during kill -9)");
    console.log(`  setup: ${SESSIONS} sessions per run, each turn still running when the hub is killed`);
    console.log("  hub recovery_ms:", fmt(rec));
    console.log(`  lost answers: ${lostAnswers} · replayed output: ${duplicateOutput} · not controllable: ${uncontrolled} · resumed a different provider session: ${foreignResume}`);
    const ok = rec.max < 3000 && lostAnswers === 0 && duplicateOutput === 0 && uncontrolled === 0 && foreignResume === 0;
    console.log(`  verdict: ${ok ? "PASS" : "FAIL"} (adopted turn finishes, output once, same provider session afterwards)`);
    return ok;
  } finally {
    await hub.stop();
  }
}

const ok =
  mode === "discovery"
    ? await discovery()
    : mode === "recovery"
      ? await recovery()
      : mode === "recovery-provider"
        ? await recoveryProvider()
        : null;
if (ok === null) {
  console.error("usage: node scripts/messlauf-p5.mjs discovery|recovery|recovery-provider [--runs N]");
  process.exit(2);
}
process.exit(ok ? 0 : 1);
