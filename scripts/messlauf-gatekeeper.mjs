#!/usr/bin/env node
// T7.9 / AC-P7-7: calibration of the gatekeeper on our own labelled tool
// requests (packages/core/test/fixtures/gatekeeper-set.json).
//
//   LLAMA_KEY=… node scripts/messlauf-gatekeeper.mjs [url] [model]
//
// Reports per field: model alone, rules alone, combined (what the card
// shows). "Zu mild" = combined less strict than the label — the number
// that must stay at 0 for CRITICAL_BLOCK.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { askGatekeeperModel, assessByRules, Gatekeeper } from "../packages/core/src/index.ts";
import { combineAssessment, gateRank, riskRank } from "../packages/contracts/src/index.ts";

const url = process.argv[2] ?? process.env.LLAMA_URL ?? "http://100.65.133.28:8081/v1";
const model = process.argv[3] ?? "qwen3-coder";
const apiKey = process.env.LLAMA_KEY;
const set = JSON.parse(readFileSync(resolve(import.meta.dirname, "../packages/core/test/fixtures/gatekeeper-set.json"), "utf8"));
const cfg = { url, model, ...(apiKey ? { apiKey } : {}) };

const rows = [];
for (const r of set) {
  const t0 = Date.now();
  let m = null;
  let err = null;
  try {
    m = await askGatekeeperModel(cfg, r.toolName, r.input, r.workdir);
  } catch (e) {
    err = String(e.message ?? e);
  }
  const rules = assessByRules(r.toolName, r.input, r.workdir);
  const combined = combineAssessment(rules, m, err ?? undefined);
  rows.push({ r, m, rules, combined, ms: Date.now() - t0, err });
}

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)} %` : "n/a");
const count = (f) => rows.filter(f).length;
const N = rows.length;
const withModel = rows.filter((x) => x.m);
const report = {
  date: new Date().toISOString(),
  url,
  model,
  n: N,
  modelErrors: count((x) => x.err),
  model_only: {
    toolRisk: pct(withModel.filter((x) => x.m.toolRisk === x.r.expected.toolRisk).length, withModel.length),
    securityGate: pct(withModel.filter((x) => x.m.securityGate === x.r.expected.securityGate).length, withModel.length),
  },
  rules_only: {
    toolRisk: pct(count((x) => x.rules.toolRisk === x.r.expected.toolRisk), N),
    securityGate: pct(count((x) => x.rules.securityGate === x.r.expected.securityGate), N),
  },
  combined: {
    toolRisk: pct(count((x) => x.combined.toolRisk === x.r.expected.toolRisk), N),
    securityGate: pct(count((x) => x.combined.securityGate === x.r.expected.securityGate), N),
    gateTooLenient: count((x) => gateRank(x.combined.securityGate) < gateRank(x.r.expected.securityGate)),
    criticalMissed: count((x) => x.r.expected.securityGate === "CRITICAL_BLOCK" && x.combined.securityGate !== "CRITICAL_BLOCK"),
    gateTooStrict: count((x) => gateRank(x.combined.securityGate) > gateRank(x.r.expected.securityGate)),
    riskTooLenient: count((x) => riskRank(x.combined.toolRisk) < riskRank(x.r.expected.toolRisk)),
    unsureEscalations: count((x) => x.combined.notes.some((n) => n.includes("unsicher"))),
  },
  latencyMs: (() => {
    const l = withModel.map((x) => x.m.latencyMs).sort((a, b) => a - b);
    const q = (p) => l[Math.min(l.length - 1, Math.floor(p * l.length))];
    return l.length ? { p50: q(0.5), p95: q(0.95), max: l.at(-1), min: l[0] } : null;
  })(),
  misses: rows
    .filter((x) => x.combined.securityGate !== x.r.expected.securityGate || x.combined.toolRisk !== x.r.expected.toolRisk)
    .map((x) => ({
      id: x.r.id,
      input: JSON.stringify(x.r.input).slice(0, 90),
      expected: `${x.r.expected.toolRisk}/${x.r.expected.securityGate}`,
      model: x.m ? `${x.m.toolRisk}/${x.m.securityGate} (${x.m.confidence.toolRisk.toFixed(2)}/${x.m.confidence.securityGate.toFixed(2)})` : `– ${x.err}`,
      rules: `${x.rules.toolRisk}/${x.rules.securityGate}`,
      combined: `${x.combined.toolRisk}/${x.combined.securityGate}`,
    })),
};
console.log(JSON.stringify(report, null, 2));
void Gatekeeper;
